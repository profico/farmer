import type { TaskGroup } from "@farmer/core/lib/task-taxonomy";
import {
	CopySimpleIcon,
	GitCommitIcon,
	GitPullRequestIcon,
	PencilSimpleIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ProjectIcon } from "#/components/projects/project-icon.tsx";
import {
	AddBlockDialog,
	type ExistingTimeEntry,
} from "#/components/time/add-block-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { formatClock } from "#/lib/format-hours.ts";
import { springProductive } from "#/lib/motion.ts";
import { taskGroupChipClass } from "#/lib/task-group-colors.ts";
import { cn } from "#/lib/utils.ts";
import { queryKeys } from "#/queries/keys.ts";
import {
	createTimeEntry,
	deleteTimeEntry,
	setTimeEntryOvertime,
	updateTimeEntryDescription,
} from "#/server/time-entries.ts";

/** How much of a note a collapsed row shows. Two comfortable lines at the
 *  width the list is read at, and a hard number rather than a measurement — see
 *  the note beside `isLong`. */
const NOTE_LIMIT = 220;

export type EntryBlockRowEntry = ExistingTimeEntry & {
	project: {
		name: string;
		code: string | null;
		icon?: string | null;
		client: { name: string } | null;
	} | null;
	task: {
		name: string;
		color: string | null;
		isAbsence: boolean;
		group?: TaskGroup | null;
	};
	commitCount?: number;
	pullRequestCount?: number;
};

/** The row's name in one string, for a tooltip or a screen reader: the project,
 *  its client, and the task under it. An absence has no project and just names
 *  itself.
 *
 *  The visible row no longer reads this. It used to be Harvest's
 *  "[CODE] Project (Client)", with the code leading because it is what people
 *  say out loud — but a bracketed monospace code in front of every name is the
 *  loudest thing in the list and starts every project at a different x. The
 *  code is now a chip AFTER the name (DESIGN.md, "Table heads and rows"), so
 *  the names line up and the eye can run down them. */
export function entryHeading(entry: EntryBlockRowEntry): string {
	if (!entry.project) return entry.task.name;
	const client = entry.project.client ? ` (${entry.project.client.name})` : "";
	return `${entry.project.name}${client} · ${entry.task.name}`;
}

export function EntryBlockRow({
	entry,
	timezone,
}: {
	entry: EntryBlockRowEntry;
	timezone: string;
}) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();

	// Inline note editing: local draft synced from the server value, saved on
	// blur only when it actually changed.
	const [note, setNote] = useState(entry.description ?? "");
	useEffect(() => {
		setNote(entry.description ?? "");
	}, [entry.description]);

	const noteMutation = useMutation({
		mutationFn: (description: string) =>
			updateTimeEntryDescription({
				data: { timeEntryId: entry.id, description },
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not save note");
			setNote(entry.description ?? "");
		},
	});

	const saveNote = () => {
		const trimmed = note.trimEnd();
		if (trimmed === (entry.description ?? "")) return;
		noteMutation.mutate(trimmed);
	};

	const overtimeMutation = useMutation({
		mutationFn: (overtime: boolean) =>
			setTimeEntryOvertime({ data: { timeEntryId: entry.id, overtime } }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not update overtime");
		},
	});

	// Re-creates a just-deleted entry from its server snapshot, used by the undo
	// toast. Under the duration-only model this is a straight field copy — there
	// are no timestamps to reconstruct.
	const restore = async (deleted: {
		projectId: string | null;
		taskId: string;
		description: string;
		date: string;
		durationSeconds: number;
		overtime: boolean;
		meetingUrl: string | null;
		calendarEventId: string | null;
	}) => {
		try {
			await createTimeEntry({
				data: {
					taskId: deleted.taskId,
					projectId: deleted.projectId ?? undefined,
					description: deleted.description || undefined,
					date: deleted.date,
					durationSeconds: deleted.durationSeconds,
					overtime: deleted.overtime,
					fillsDay: false,
					// Carried so a restored meeting keeps its link — and so the service
					// clears the tombstone the delete just wrote, which is what makes
					// undo work at all for a synced meeting.
					meetingUrl: deleted.meetingUrl ?? undefined,
					calendarEventId: deleted.calendarEventId ?? undefined,
				},
			});
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not restore entry",
			);
		}
	};

	// The collapse is driven from local state rather than from an `exit` prop,
	// because the row is the only thing that knows it is being deleted.
	//
	// It used to be an AnimatePresence `exit`, which had two failure modes. The
	// loud one: presence knows a row *left*, not *why*, so paging to another day
	// replaced every entry at once and the whole list played the delete
	// animation. The silent one: motion compares `presenceContext` against
	// `prevPresenceContext` to spot the leaving edge, but shifts that pair on
	// every commit — so when the delete's query invalidation landed several
	// commits in a burst, the edge was consumed unobserved, the exit never ran,
	// and `onExitComplete` never fired. AnimatePresence then held the row in the
	// DOM permanently: a full-height entry, showing time that was no longer
	// logged, next to a total that no longer counted it.
	const [collapsing, setCollapsing] = useState(false);

	const deleteMutation = useMutation({
		mutationFn: () => deleteTimeEntry({ data: entry.id }),
		onSuccess: async (deleted) => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
			// Fill blocks are derived, and a rule-generated entry leaves a skip behind
			// (re-creating it as a manual copy would double up) — neither can be
			// restored by re-creating a row, so neither offers undo.
			//
			// A calendar-linked entry USED to be in that list, because deleting one
			// writes a tombstone the sync engine honours forever. It offers undo now:
			// re-creating an entry with its `calendarEventId` clears that tombstone
			// (timeEntriesService.create), so the restore is real and the meeting is
			// not lost to one misclick.
			const undoable =
				deleted && !deleted.fillsDay && !deleted.generatedFromRuleId;
			if (undoable) {
				toast("Entry deleted", {
					action: { label: "Undo", onClick: () => restore(deleted) },
				});
			} else {
				toast("Entry deleted");
			}
		},
		onError: (error) => {
			// Put the row back — it is still there, and a collapsed one would read
			// as deleted while the toast says otherwise.
			setCollapsing(false);
			toast.error(error.message ?? "Could not delete time entry");
		},
	});

	// Duplicating is the same write `restore` makes, from the row in hand: the
	// commonest way to log a second block is that it is nearly the first one.
	const duplicateMutation = useMutation({
		mutationFn: () =>
			createTimeEntry({
				data: {
					taskId: entry.taskId,
					projectId: entry.projectId ?? undefined,
					description: entry.description || undefined,
					date: entry.date,
					durationSeconds: entry.durationSeconds,
					overtime: entry.overtime,
					fillsDay: false,
				},
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
			toast("Entry duplicated");
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not duplicate entry");
		},
	});

	// The note is held to a fixed number of CHARACTERS, not to a number of
	// lines, and that is deliberate.
	//
	// It was `-webkit-line-clamp` twice, and failed twice. First on a textarea,
	// which cannot be clamped at all: the property works on line boxes inside a
	// block, and a textarea's value is not laid out as ones it can reach. Then
	// on a button carrying `block`, where the clamp lost the cascade — `block`
	// is a Tailwind utility and `.clamp-2` is in the components layer, and
	// utilities sort after components, so `display: block` quietly replaced
	// `display: -webkit-box` and the clamp did nothing.
	//
	// A character cap cannot be beaten by a layer, needs no measurement, and is
	// the same on every window width. `line-clamp-2` rides along for the case
	// where 220 characters still wrap past two lines in a narrow column.
	const [expanded, setExpanded] = useState(false);
	const [editing, setEditing] = useState(false);
	const isLong = note.length > NOTE_LIMIT;
	const shownNote =
		isLong && !expanded ? `${note.slice(0, NOTE_LIMIT).trimEnd()}…` : note;

	return (
		// The row is a hover group: its actions are hidden at rest and slide in
		// under the pointer or the keyboard (`.row-actions`, styles.css). They used
		// to be three permanent words — OT, Edit, Delete — on every row of every
		// list, which put nine controls on a three-entry day and made the actions
		// louder than the time they act on.
		//
		// Three parts, and the split is the whole design. The STUB at the left
		// holds the project's code and mark and nothing else, so the code never
		// competes with the name and every name starts at the same x. The BODY
		// holds identity on line one (project, client, task) and the note on line
		// two, aligned under the name rather than under the code. The TIME sits in
		// its own box at the right, pinned to the top so a four-line note does not
		// leave the figure floating in the middle of a tall row.
		//
		// Delete only, no enter. Deleting a row used to drop it instantly and snap
		// everything below it upward while the "Undo" toast slid in from the far
		// corner — two unrelated movements for one action, and no clue which row
		// the toast was offering back. Collapsing the row instead keeps the two
		// tied together. There is deliberately no matching enter: a new row
		// arrives as its dialog closes, and that beat is already covered.
		//
		// Collapsing and deleting start together rather than in sequence: the
		// request is never gated on an animation finishing, so a frame that never
		// arrives can cost the collapse but never the delete.
		// `prefers-reduced-motion` is handled globally by the root
		// <MotionConfig reducedMotion="user">.
		<motion.div
			animate={collapsing ? { height: 0, opacity: 0 } : undefined}
			transition={springProductive}
			className="group/row overflow-hidden"
		>
			{/* A row of a list between hairlines, not a card: the page is the only
			    island, so the row carries no fill of its own. The soft hairline
			    closes each row; the list's top rule belongs to its parent. */}
			<div className="flex items-start gap-3 border-b border-line2 py-3">
				{/* The stub. A column rather than a prefix: the code is an id, and an
				    id in front of a name starts every name at a different x. */}
				<div className="flex w-12 shrink-0 flex-col items-center gap-1 pt-0.5 sm:w-14">
					{/* The mark is the thing you recognise a project by, so it leads at
					    full size; the code is a reference you read only when you need
					    it, so it sits under the mark at 10px. They were the same weight,
					    which made a five-letter string compete with a logo. */}
					{entry.project ? (
						<ProjectIcon
							size="sm"
							icon={entry.project.icon}
							name={entry.project.name}
							className="size-7 rounded-[7px] border-0 transition-transform duration-(--dur-base) group-hover/row:-translate-y-px"
						/>
					) : (
						<span
							className="size-2.5 rounded-full"
							style={{
								backgroundColor: entry.task.color ?? "var(--muted-foreground)",
							}}
						/>
					)}
					{entry.project?.code && (
						<span className="mono w-full truncate text-center text-[10px] leading-none text-faint">
							{entry.project.code}
						</span>
					)}
				</div>

				<div className="flex min-w-0 flex-1 items-start gap-3">
					<div className="min-w-0 flex-1">
						{/* Identity: what this row is. The client sits with the project
						    because they are the same kind of fact; the task sits here
						    rather than beside the note because it is a property of the
						    row, not a prefix to what you wrote. */}
						<div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
							<p className="truncate font-semibold tracking-[-0.01em]">
								{entry.project ? entry.project.name : entry.task.name}
							</p>
							{entry.project?.client && (
								<span className="truncate text-sm text-muted-foreground">
									{entry.project.client.name}
								</span>
							)}
							{entry.project && (
								<span
									className={cn(
										"shrink-0 rounded-md px-1.5 py-0.5 text-2xs font-medium",
										taskGroupChipClass(entry.task.group),
									)}
								>
									{entry.task.name}
								</span>
							)}
							{entry.fillsDay && (
								<span className="eyebrow shrink-0 rounded-full bg-muted px-1.5 py-0.5">
									Rest of day
								</span>
							)}
							{entry.overtime && (
								<span className="eyebrow shrink-0 rounded-full bg-warn/12 px-1.5 py-0.5 text-warn">
									Overtime
								</span>
							)}
							{!!entry.commitCount && entry.commitCount > 0 && (
								<span
									className="mono flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
									title={`${entry.commitCount} linked commit${entry.commitCount === 1 ? "" : "s"}`}
								>
									<GitCommitIcon className="size-3" />
									{entry.commitCount}
								</span>
							)}
							{!!entry.pullRequestCount && entry.pullRequestCount > 0 && (
								<span
									className="mono flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
									title={`${entry.pullRequestCount} linked pull request${entry.pullRequestCount === 1 ? "" : "s"}`}
								>
									<GitPullRequestIcon className="size-3" />
									{entry.pullRequestCount}
								</span>
							)}
						</div>

						{/* Editable in place: click the text and it becomes the field.
						    Never a dialog for a note. The textarea grows to its content
						    while it is open, because you cannot edit the third line of
						    something showing two. */}
						{editing ? (
							<Textarea
								autoFocus
								value={note}
								onChange={(event) => setNote(event.target.value)}
								onBlur={() => {
									saveNote();
									setEditing(false);
								}}
								onKeyDown={(event) => {
									// Escape abandons the edit and puts the stored value back,
									// which is what every other inline field in the app does.
									if (event.key === "Escape") {
										setNote(entry.description ?? "");
										setEditing(false);
									}
								}}
								placeholder="Add a note…"
								rows={1}
								className="mt-1 -ml-1.5 max-h-56 min-h-6 w-full resize-none overflow-y-auto rounded-md border-transparent bg-background px-1.5 py-0.5 text-sm leading-relaxed [field-sizing:content] placeholder:text-faint"
							/>
						) : (
							<button
								type="button"
								// A real button: it opens the editor, which is what a button
								// does. `text-left` and `whitespace-pre-wrap` are what let a
								// button's label hold a wrapped, multi-line note.
								aria-label={note ? `Edit note: ${note}` : "Add a note"}
								onClick={() => setEditing(true)}
								className={cn(
									"w-full cursor-text rounded-md border border-transparent px-1.5 py-0.5 text-left text-sm leading-relaxed whitespace-pre-wrap transition-colors duration-(--dur-fast) outline-none hover:border-input focus-visible:ring-3 focus-visible:ring-ring/16",
									"mt-1 -ml-1.5",
									!expanded && "line-clamp-2",
									note ? "text-muted-foreground" : "text-faint",
								)}
							>
								{shownNote || "Add a note…"}
							</button>
						)}
						{!editing && isLong && (
							<button
								type="button"
								onClick={() => setExpanded((open) => !open)}
								className="mt-0.5 rounded-sm text-xs font-medium text-primary transition-colors duration-(--dur-fast) outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/16"
							>
								{expanded ? "Show less" : "Show more"}
							</button>
						)}
					</div>

					<div className="flex shrink-0 items-start gap-1.5">
						<div className="row-actions flex items-center gap-0.5">
							{!entry.task.isAbsence && !entry.fillsDay && (
								<Tooltip>
									<TooltipTrigger
										render={
											<Button
												variant="ghost"
												size="icon-sm"
												className={cn(
													"text-muted-foreground",
													entry.overtime && "text-warn",
												)}
												onClick={() => overtimeMutation.mutate(!entry.overtime)}
												disabled={overtimeMutation.isPending}
												aria-label={
													entry.overtime ? "Not overtime" : "Mark as overtime"
												}
											>
												<span className="text-2xs font-medium">OT</span>
											</Button>
										}
									/>
									<TooltipContent>
										{entry.overtime ? "Not overtime" : "Mark as overtime"}
									</TooltipContent>
								</Tooltip>
							)}
							<AddBlockDialog
								timezone={timezone}
								defaultDate={entry.date}
								entry={entry}
								trigger={
									<Button
										variant="ghost"
										size="icon-sm"
										className="text-muted-foreground"
										aria-label="Edit entry"
									>
										<PencilSimpleIcon weight="regular" />
									</Button>
								}
							/>
							<Tooltip>
								<TooltipTrigger
									render={
										<Button
											variant="ghost"
											size="icon-sm"
											className="text-muted-foreground"
											onClick={() => duplicateMutation.mutate()}
											disabled={duplicateMutation.isPending}
											aria-label="Duplicate entry"
										>
											<CopySimpleIcon weight="regular" />
										</Button>
									}
								/>
								<TooltipContent>Duplicate</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger
									render={
										<Button
											variant="ghost"
											size="icon-sm"
											className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
											onClick={() => {
												setCollapsing(true);
												deleteMutation.mutate();
											}}
											disabled={deleteMutation.isPending}
											aria-label="Delete entry"
										>
											<TrashIcon weight="regular" />
										</Button>
									}
								/>
								<TooltipContent>Delete</TooltipContent>
							</Tooltip>
						</div>
						{/* Pinned to the top of the row rather than centred: with a
						    four-line note, a centred figure floats halfway down a tall
						    row and stops lining up with its neighbours. Plain figures,
						    not a box, and Geist Mono, because a column of times has to
						    line up and neither Hedvig nor Inclusive Sans has tabular
						    figures. */}
						<span className="mono min-w-14 shrink-0 pt-0.5 text-right text-md font-medium">
							{formatClock(entry.durationSeconds)}
						</span>
					</div>
				</div>
			</div>
		</motion.div>
	);
}
