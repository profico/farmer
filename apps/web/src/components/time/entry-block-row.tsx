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
import { cn } from "#/lib/utils.ts";
import { queryKeys } from "#/queries/keys.ts";
import {
	createTimeEntry,
	deleteTimeEntry,
	setTimeEntryOvertime,
	updateTimeEntryDescription,
} from "#/server/time-entries.ts";

export type EntryBlockRowEntry = ExistingTimeEntry & {
	project: {
		name: string;
		code: string | null;
		icon?: string | null;
		client: { name: string } | null;
	} | null;
	task: { name: string; color: string | null; isAbsence: boolean };
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

	return (
		// The row is a hover group: its actions are hidden at rest and slide in
		// under the pointer or the keyboard (`.row-actions`, styles.css). They used
		// to be three permanent words — OT, Edit, Delete — on every row of every
		// list, which put nine controls on a three-entry day and made the actions
		// louder than the time they act on.
		//
		// Wraps on a phone: the figure and the actions are a fixed ~140px, and
		// holding them on the same line as the text squeezed a project name down
		// to a dozen characters. Touch has no hover, so the actions are always
		// visible there — see the `(hover: none)` rule beside `.row-actions`.
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
		//
		// `overflow-hidden` is what makes the collapse read as the row closing
		// rather than its contents spilling; the controls inside are inset far
		// enough from the edges that it never clips a focus ring.
		// `prefers-reduced-motion` is handled globally by the root
		// <MotionConfig reducedMotion="user">.
		<motion.div
			animate={
				collapsing
					? { height: 0, opacity: 0, paddingTop: 0, paddingBottom: 0 }
					: undefined
			}
			transition={springProductive}
			className="group/row group/entry flex flex-wrap items-start gap-x-3 gap-y-1 overflow-hidden px-4 py-3 transition-colors duration-(--dur-fast) hover:bg-muted sm:flex-nowrap sm:px-8"
		>
			{/* The project's own mark, which is what tells fifteen rows apart at a
			    glance — its uploaded logo, its emoji, or the first letter of its
			    name. An absence has no project, so it keeps the task's colour as a
			    dot: a lettered box for "Vacation" would read as a project that
			    isn't there. */}
			{entry.project ? (
				<ProjectIcon
					size="sm"
					icon={entry.project.icon}
					name={entry.project.name}
					className="mt-0.5 transition-transform duration-(--dur-base) group-hover/row:-translate-y-px"
				/>
			) : (
				<span
					className="mt-2 size-2 shrink-0 rounded-full"
					style={{
						backgroundColor: entry.task.color ?? "var(--muted-foreground)",
					}}
				/>
			)}
			<div className="min-w-0 flex-1">
				{/* The project, then what it was, then the note. The hierarchy is
				    load-bearing: you scan for the project, confirm the task, and
				    read the note only if you need the detail. */}
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<p className="truncate text-base font-medium">
						{entry.project ? entry.project.name : entry.task.name}
					</p>
					{entry.project?.code && (
						<span className="mono shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-2xs text-muted-foreground">
							{entry.project.code}
						</span>
					)}
					{entry.project && (
						<span className="shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
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
				{entry.project?.client && (
					<p className="truncate text-sm text-muted-foreground">
						{entry.project.client.name}
					</p>
				)}
				<Textarea
					value={note}
					onChange={(event) => setNote(event.target.value)}
					onBlur={saveNote}
					placeholder="Add a note…"
					rows={1}
					className="mt-0.5 -ml-1.5 min-h-7 w-full resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-muted-foreground shadow-none [field-sizing:content] placeholder:text-faint hover:border-input focus-visible:border-ring focus-visible:bg-background focus-visible:text-foreground"
				/>
			</div>
			<div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto sm:gap-3">
				<span className="mono mr-auto text-base sm:mr-0">
					{formatClock(entry.durationSeconds)}
				</span>
				{/* Overtime is a one-click toggle from the row: it is purely manual, and
				    making people reopen the dialog for it guarantees it never gets set.
				    It stays visible once ON — at that point it is a state the row is
				    in, not an action waiting to be found. */}
				{!entry.task.isAbsence && !entry.fillsDay && (
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									className={cn(
										"text-faint",
										entry.overtime
											? "text-warn"
											: "row-actions hover:text-foreground",
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
				<div className="row-actions flex items-center gap-0.5">
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
			</div>
		</motion.div>
	);
}
