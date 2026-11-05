import { timeKeyInTz } from "@farmer/core/lib/time";
import { TrayIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { GoogleCalendarMark } from "#/components/google-calendar-mark.tsx";
import { ProjectPicker } from "#/components/pickers/project-picker.tsx";
import { TaskPicker } from "#/components/pickers/task-picker.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { formatDateKeyShort } from "#/lib/format-date.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";
import { useHeightTransition } from "#/lib/motion.ts";
import {
	type DeletedTimeEntry,
	isRestorable,
	restoreTimeEntries,
} from "#/lib/restore-time-entries.ts";
import { cn } from "#/lib/utils.ts";
import { queryKeys } from "#/queries/keys.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { selectableTasksQuery } from "#/queries/tasks.ts";
import { unfiledEntriesQuery } from "#/queries/time-entries.ts";
import { invalidateTimer } from "#/queries/timer.ts";
import { deleteTimeEntry, fileTimeEntries } from "#/server/time-entries.ts";

// Everything the engines write lands with no project: the calendar sync files
// meetings this way, and so do commit fill blocks and accepted day-assembly
// suggestions. That time is real and counts toward the day, but it is invisible
// to every project report, so it needs a surface. This is it.
//
// Deliberately NOT dismissible, unlike AutoTrackNag: that one nudges you toward
// an optional feature, this one is a worklist of your own unattributed hours.

// Scoped to the week or month on screen (the layout route hands it the range).
// The Time nav badge keeps the wider `unfiledWindow`, so the count of everything
// still shows somewhere; this banner is about the time in front of you.
export function UnfiledEntriesBanner({
	range,
	scopeLabel,
	timezone,
}: {
	/** The week or month on screen. The banner counts only this. */
	range: { from: string; to: string };
	/** "this week" / "this month", for the headline. */
	scopeLabel: string;
	/** The org's timezone: a meeting's start is shown in it, like every other
	 *  clock time in the app. */
	timezone: string;
}) {
	const heightTransition = useHeightTransition();
	const orgSlug = useOrgSlug();
	const [open, setOpen] = useState(false);
	const { from, to } = range;

	const { data: entries } = useQuery({
		...unfiledEntriesQuery(orgSlug, from, to),
		staleTime: 60_000,
	});

	const count = entries?.length ?? 0;
	const seconds = (entries ?? []).reduce(
		(sum, e) => sum + e.durationSeconds,
		0,
	);
	// Say what the person is looking at, not what the database holds. "Entries
	// aren't filed against a project" is the schema talking; "3 calendar
	// meetings need a project" is the list. A list with anything else on it
	// (a rest-of-day block, an accepted suggestion) counts the two apart.
	const meetings = (entries ?? []).filter(isCalendarMeeting).length;
	const others = count - meetings;
	const allMeetings = count > 0 && others === 0;
	const headline = allMeetings
		? `${meetings} calendar ${meetings === 1 ? "meeting" : "meetings"} ${scopeLabel} ${meetings === 1 ? "needs" : "need"} a project`
		: meetings === 0
			? `${count} ${count === 1 ? "entry" : "entries"} ${scopeLabel} ${count === 1 ? "needs" : "need"} a project`
			: `${meetings} calendar ${meetings === 1 ? "meeting" : "meetings"} and ${others} other ${others === 1 ? "entry" : "entries"} ${scopeLabel} need a project`;

	return (
		<>
			<AnimatePresence initial={false}>
				{count > 0 && (
					<motion.div
						key="unfiled-entries"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={heightTransition}
						className="mb-4 shrink-0 overflow-hidden rounded-lg border bg-secondary"
					>
						<div className="flex items-center gap-3 px-4 py-3">
							{meetings > 0 ? (
								<GoogleCalendarMark />
							) : (
								<TrayIcon className="size-4 shrink-0 text-primary" />
							)}
							<div className="min-w-0 flex-1">
								<p className="text-base font-medium">{headline}</p>
								<p className="text-sm text-muted-foreground">
									{allMeetings
										? `${formatHoursShort(seconds)} synced from Google Calendar. Add each meeting to its project so the time shows up in reports.`
										: `${formatHoursShort(seconds)} of your time isn't on any project yet, so it's missing from reports.`}
								</p>
							</div>
							<Button size="sm" onClick={() => setOpen(true)}>
								{allMeetings ? "Add events" : "File them"}
							</Button>
						</div>
					</motion.div>
				)}
			</AnimatePresence>

			<FileEntriesDialog
				open={open}
				onOpenChange={setOpen}
				from={from}
				to={to}
				timezone={timezone}
			/>
		</>
	);
}

type UnfiledEntry = {
	id: string;
	date: string;
	description: string;
	durationSeconds: number;
	taskId: string;
	taskName: string;
	calendarEventId: string | null;
	/** When the meeting starts, per the calendar. Null on anything that is not
	 *  a synced meeting. A `Date` on the server and whatever the transport made
	 *  of it here, so it is always re-wrapped before it is read. */
	meetingStartsAt: Date | string | null;
};

const isCalendarMeeting = (entry: { calendarEventId: string | null }) =>
	entry.calendarEventId != null;

/** "Wed, Sep 17 at 14:00" for a meeting, "Wed, Sep 17" for anything else. */
const whenLabel = (entry: UnfiledEntry, timezone: string): string => {
	const day = formatDateKeyShort(entry.date);
	if (!entry.meetingStartsAt) return day;
	return `${day} at ${timeKeyInTz(new Date(entry.meetingStartsAt), timezone)}`;
};

/** Entries that are the same piece of recurring work: same task, same title,
 *  same length. A weekly stand-up is forty rows of one answer, and answering it
 *  forty times is the whole complaint about this screen. */
type UnfiledGroup = {
	key: string;
	title: string;
	taskName: string;
	entries: UnfiledEntry[];
	seconds: number;
	/** Every row in the group came from the calendar. */
	fromCalendar: boolean;
};

const groupUnfiled = (entries: UnfiledEntry[]): UnfiledGroup[] => {
	const byKey = new Map<string, UnfiledGroup>();
	for (const entry of entries) {
		const title = entry.description || entry.taskName;
		const key = `${entry.taskId}|${title.trim().toLowerCase()}|${entry.durationSeconds}`;
		const group = byKey.get(key);
		if (group) {
			group.entries.push(entry);
			group.seconds += entry.durationSeconds;
			group.fromCalendar &&= isCalendarMeeting(entry);
		} else {
			byKey.set(key, {
				key,
				title,
				taskName: entry.taskName,
				entries: [entry],
				seconds: entry.durationSeconds,
				fromCalendar: isCalendarMeeting(entry),
			});
		}
	}
	// Biggest backlog first — the recurring meeting that produced thirty rows is
	// the one worth answering, and it should not be buried under one-offs.
	return [...byKey.values()].sort(
		(a, b) => b.entries.length - a.entries.length || b.seconds - a.seconds,
	);
};

function FileEntriesDialog({
	open,
	onOpenChange,
	from,
	to,
	timezone,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	from: string;
	to: string;
	timezone: string;
}) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: entries } = useQuery({
		...unfiledEntriesQuery(orgSlug, from, to),
		enabled: open,
	});
	// `myProjectsQuery`, not `projectsQuery`: this dropdown is a "file this time
	// against" picker, and the write behind it (`timeEntriesService.update`)
	// asserts `canTrackOn`. Listing every project in the organization offered
	// choices the server was always going to refuse — pick one you are not
	// assigned to and filing failed with "You are not assigned to this project".
	// Every other entry picker in the app (add-block, add-row) already asks this
	// question this way.
	const { data: projects } = useQuery({
		...myProjectsQuery(orgSlug),
		enabled: open,
	});
	// Every live non-absence task, which is exactly what may go on a project.
	const { data: tasks } = useQuery({
		...selectableTasksQuery(orgSlug),
		enabled: open,
	});

	const groups = groupUnfiled(entries ?? []);
	const allMeetings =
		(entries?.length ?? 0) > 0 && (entries ?? []).every(isCalendarMeeting);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [projectId, setProjectId] = useState<string | null>(null);
	// "" keeps each entry's own task. A rest-of-day block lands as Development
	// and is often design or product work, so the task is a choice here too.
	const [taskId, setTaskId] = useState("");
	// "Always file this one here." Off by default: a standing rule about future
	// time is a bigger statement than filing the rows in front of you, and it
	// should be something you asked for rather than something you forgot to
	// untick. Managed under Settings → Preferences afterwards.
	const [remember, setRemember] = useState(false);

	// Start clean on each open: the list behind it has changed, and a selection
	// carried over from last time would be filing rows nobody just looked at.
	const [wasOpen, setWasOpen] = useState(false);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setSelectedIds(new Set());
			setProjectId(null);
			setTaskId("");
			setRemember(false);
		}
	}

	const toggleGroup = (group: UnfiledGroup) => {
		setSelectedIds((current) => {
			const next = new Set(current);
			const allIn = group.entries.every((e) => next.has(e.id));
			for (const entry of group.entries) {
				if (allIn) next.delete(entry.id);
				else next.add(entry.id);
			}
			return next;
		});
	};

	const selectedSeconds = (entries ?? [])
		.filter((e) => selectedIds.has(e.id))
		.reduce((sum, e) => sum + e.durationSeconds, 0);

	const fileMutation = useMutation({
		mutationFn: () =>
			fileTimeEntries({
				data: {
					timeEntryIds: [...selectedIds],
					projectId: projectId ?? "",
					taskId: taskId || undefined,
					remember,
				},
			}),
		onSuccess: async ({ filed, failed, firstError, remembered }) => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).timeEntries],
				}),
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).filingRules],
				}),
				invalidateTimer(queryClient, orgSlug),
			]);
			setSelectedIds(new Set());
			if (failed > 0) {
				// The one real failure here is a task the project hasn't picked, so
				// say which rule was hit rather than just how many rows bounced.
				toast.error(
					`Filed ${filed}, ${failed} could not be filed: ${firstError ?? "unknown reason"}`,
				);
			} else {
				// The rule count is named rather than assumed: an entry with no
				// description carries nothing to key a rule on and is skipped, so
				// "remembered 3" after ticking four groups is information, not a bug.
				toast.success(
					remembered > 0
						? `Filed ${filed} ${filed === 1 ? "entry" : "entries"} · will file ${remembered} ${remembered === 1 ? "meeting" : "meetings"} here from now on`
						: `Filed ${filed} ${filed === 1 ? "entry" : "entries"}`,
				);
			}
		},
		onError: (error: Error) => toast.error(error.message),
	});

	// Puts back what the last Remove deleted, from the snapshots the delete
	// returned. The same undo the timesheet row offers, over a batch.
	const undoRemove = async (deleted: DeletedTimeEntry[]) => {
		try {
			await restoreTimeEntries(deleted);
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
			const count = deleted.length;
			toast.success(`Put back ${count} ${count === 1 ? "entry" : "entries"}`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not put them back",
			);
		}
	};

	// The other answer to "where does this go": nowhere, because it didn't
	// happen. Its own control at the end of the row, outside the label that
	// ticks the box — see `RemoveButton`. Same delete as the timesheet row's, so
	// a calendar meeting gets its tombstone and the next sync does not bring it
	// back, and so the toast offers the same Undo, which clears that tombstone
	// again. Assemble my day can also re-offer it with "include dismissed".
	const removeMutation = useMutation({
		mutationFn: async (ids: string[]) => {
			// One delete per row, and a failure kept rather than thrown. A batch
			// that stops halfway has still deleted everything up to the row that
			// failed, and throwing sent the whole thing to `onError` — no
			// invalidation, so the dialog went on listing rows that are gone, and
			// no pruning, so they stayed ticked and the next Add to project asked
			// the server to file them.
			const removed: string[] = [];
			// What undo can put back: `remove` hands the deleted row back for
			// exactly this, and a fill block or a rule-generated entry is not
			// restorable by re-creating a row.
			const restorable: DeletedTimeEntry[] = [];
			let firstError: string | null = null;
			for (const id of ids) {
				try {
					const deleted = await deleteTimeEntry({ data: id });
					removed.push(id);
					if (deleted && isRestorable(deleted)) restorable.push(deleted);
				} catch (error) {
					firstError ??=
						error instanceof Error ? error.message : "unknown reason";
				}
			}
			return { removed, restorable, firstError };
		},
		onSuccess: async ({ removed, restorable, firstError }, ids) => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).timeEntries],
				}),
				invalidateTimer(queryClient, orgSlug),
			]);
			setSelectedIds((current) => {
				const next = new Set(current);
				for (const id of removed) next.delete(id);
				return next;
			});
			if (firstError !== null) {
				toast.error(
					`Removed ${removed.length} of ${ids.length}: ${firstError}`,
				);
				return;
			}
			const count = removed.length;
			const message = allMeetings
				? `Removed ${count} ${count === 1 ? "meeting" : "meetings"} · the calendar won't bring ${count === 1 ? "it" : "them"} back`
				: `Removed ${count} ${count === 1 ? "entry" : "entries"}`;
			toast.success(
				message,
				restorable.length > 0
					? { action: { label: "Undo", onClick: () => undoRemove(restorable) } }
					: undefined,
			);
		},
		onError: (error: Error) => toast.error(error.message),
	});
	const busy = fileMutation.isPending || removeMutation.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{allMeetings ? "Add your meetings to a project" : "File your time"}
					</DialogTitle>
					<DialogDescription className="sr-only">
						File entries to a project.
					</DialogDescription>
				</DialogHeader>

				<div className="-mx-6 flex flex-col divide-y divide-line2 border-y">
					{groups.map((group) => (
						<UnfiledGroupRow
							key={group.key}
							group={group}
							timezone={timezone}
							selectedIds={selectedIds}
							removing={removeMutation.isPending}
							onRemove={(ids) => removeMutation.mutate(ids)}
							onToggleGroup={() => toggleGroup(group)}
							onToggleEntry={(id) =>
								setSelectedIds((current) => {
									const next = new Set(current);
									if (next.has(id)) next.delete(id);
									else next.add(id);
									return next;
								})
							}
						/>
					))}
					{entries?.length === 0 && (
						<p className="px-6 py-8 text-center text-sm text-muted-foreground">
							Everything's filed.
						</p>
					)}
				</div>

				{groups.length > 0 && (
					<DialogFooter className="flex-col items-stretch gap-3 sm:flex-col">
						<div className="grid gap-2 sm:grid-cols-2">
							<ProjectPicker
								projects={projects ?? []}
								value={projectId}
								onValueChange={setProjectId}
								aria-label="File against project"
							/>
							<TaskPicker
								tasks={tasks ?? []}
								value={taskId}
								onValueChange={setTaskId}
								grouped
								noTask="Keep each entry's task"
								aria-label="File under task"
							/>
						</div>
						<div className="flex items-center gap-3">
							<label className="mr-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
								<input
									type="checkbox"
									className="accent-primary"
									checked={remember}
									onChange={(event) => setRemember(event.target.checked)}
								/>
								Always file these here
							</label>
							<span className="text-xs text-muted-foreground">
								{selectedIds.size === 0
									? "Nothing selected"
									: `${selectedIds.size} selected · ${formatHoursShort(selectedSeconds)}`}
							</span>
							<Button
								disabled={selectedIds.size === 0 || !projectId || busy}
								onClick={() => fileMutation.mutate()}
							>
								{fileMutation.isPending
									? allMeetings
										? "Adding…"
										: "Filing…"
									: allMeetings
										? "Add to project"
										: "File"}
							</Button>
						</div>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}

function UnfiledGroupRow({
	group,
	timezone,
	selectedIds,
	removing,
	onRemove,
	onToggleGroup,
	onToggleEntry,
}: {
	group: UnfiledGroup;
	timezone: string;
	selectedIds: Set<string>;
	removing: boolean;
	onRemove: (ids: string[]) => void;
	onToggleGroup: () => void;
	onToggleEntry: (id: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const checkboxId = useId();
	const allIn = group.entries.every((e) => selectedIds.has(e.id));
	const someIn = !allIn && group.entries.some((e) => selectedIds.has(e.id));
	const isRecurring = group.entries.length > 1;
	const first = group.entries[0];

	return (
		<div className="py-1">
			{/* Two halves, and the split is the point. The LABEL is the tick
			    target and covers everything that identifies the group: a 16px
			    checkbox is a hard target, and a click anywhere on the row should
			    land on it. Left to right inside it: what the meeting is (Google's
			    mark on synced rows, the title, then the task and when it was), how
			    long, in the mono figure the timesheet uses, and the box at the far
			    right where a list of things to tick keeps it.

			    Remove sits OUTSIDE the label. It used to sit inside, as a word in
			    the middle of the second line of grey metadata, which made a click
			    aimed at the row delete the meeting instead of ticking it — and the
			    delete tombstones a synced meeting, so the calendar never offered it
			    again. "Show dates" is the one control still inside, and it cancels
			    the label's default so it does not tick the box on the way to its
			    own handler.

			    The label names the box with `htmlFor`. Without it, the control of a
			    label is its first labelable descendant, and a button is labelable.
			    "Show dates" comes before the box, so a click on the title of a
			    recurring group opened the dates and did not tick the box. */}
			<div
				className={cn(
					"flex items-center gap-2 rounded-md pr-3 transition-colors duration-(--dur-fast) hover:bg-muted",
					allIn && "bg-muted/60",
				)}
			>
				<label
					htmlFor={checkboxId}
					className="flex min-w-0 flex-1 cursor-pointer items-center gap-4 py-2.5 pl-6"
				>
					{group.fromCalendar ? (
						<GoogleCalendarMark />
					) : (
						<span className="size-4 shrink-0" aria-hidden="true" />
					)}
					<span className="min-w-0 flex-1">
						<span className="block truncate text-base font-medium">
							{group.title}
						</span>
						<span className="block text-sm text-muted-foreground">
							{group.taskName}
							{" · "}
							{isRecurring ? (
								<>
									{group.entries.length} occurrences
									{" · "}
									<button
										type="button"
										className="cursor-pointer underline underline-offset-3 hover:text-foreground"
										onClick={(event) => {
											event.preventDefault();
											setExpanded((current) => !current);
										}}
									>
										{expanded ? "Hide dates" : "Show dates"}
									</button>
								</>
							) : first ? (
								whenLabel(first, timezone)
							) : null}
						</span>
					</span>
					<span className="mono shrink-0 text-base tabular-nums">
						{formatHoursShort(group.seconds)}
					</span>
					<input
						id={checkboxId}
						type="checkbox"
						className="size-4 shrink-0 cursor-pointer accent-primary"
						checked={allIn}
						ref={(node) => {
							// The only honest state for a partly-selected group. Set through a
							// ref because `indeterminate` is a DOM property with no attribute.
							if (node) node.indeterminate = someIn;
						}}
						onChange={onToggleGroup}
						aria-label={`Select ${group.title}`}
					/>
				</label>
				<RemoveButton
					disabled={removing}
					what={
						isRecurring
							? `all ${group.entries.length} occurrences of ${group.title}`
							: group.title
					}
					onClick={() => onRemove(group.entries.map((e) => e.id))}
				/>
			</div>

			{expanded && (
				<div className="mb-2 flex flex-col">
					{/* Split the same way as the group row above it. */}
					{group.entries.map((entry) => (
						<div
							key={entry.id}
							className="flex items-center gap-2 rounded-md pr-3 text-sm text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
						>
							<label className="flex flex-1 cursor-pointer items-center gap-4 py-1.5 pl-14">
								<span className="flex-1">{whenLabel(entry, timezone)}</span>
								<span className="mono tabular-nums">
									{formatHoursShort(entry.durationSeconds)}
								</span>
								<input
									type="checkbox"
									className="size-4 cursor-pointer accent-primary"
									checked={selectedIds.has(entry.id)}
									onChange={() => onToggleEntry(entry.id)}
								/>
							</label>
							<RemoveButton
								disabled={removing}
								size="xs"
								what={`${group.title} on ${whenLabel(entry, timezone)}`}
								onClick={() => onRemove([entry.id])}
							/>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

/** "Remove", at the end of the row and outside its label — grey like its
 *  neighbours until the pointer is on it, then red, because it deletes. The
 *  same rule as Delete on a time entry.
 *
 *  Its own control at the row's edge, rather than a word in the row's text: the
 *  rest of the row is one tick target, so anything destructive inside it is a
 *  misclick waiting to happen, and this delete tombstones a synced meeting.
 *  Being outside the label also means it needs no `preventDefault` to stop the
 *  box ticking on the way to its handler. */
function RemoveButton({
	what,
	disabled,
	size = "sm",
	onClick,
}: {
	what: string;
	disabled: boolean;
	/** "xs" for the per-occurrence rows, which are a line shorter. */
	size?: "sm" | "xs";
	onClick: () => void;
}) {
	return (
		<Button
			variant="ghost"
			size={size}
			disabled={disabled}
			aria-label={`Remove ${what}`}
			title="Didn't happen? Remove it from the timesheet. The calendar won't bring it back, but you can undo."
			className="shrink-0 text-muted-foreground hover:text-destructive"
			onClick={onClick}
		>
			Remove
		</Button>
	);
}
