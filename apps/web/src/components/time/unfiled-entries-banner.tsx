import { timeKeyInTz } from "@farmer/core/lib/time";
import { CalendarBlankIcon, TrayIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

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
import { cn } from "#/lib/utils.ts";
import { queryKeys } from "#/queries/keys.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { selectableTasksQuery } from "#/queries/tasks.ts";
import {
	unfiledEntriesQuery,
	unfiledWindow,
	unfiledWindowQuery,
} from "#/queries/time-entries.ts";
import { fileTimeEntries } from "#/server/time-entries.ts";

// Everything the engines write lands with no project: the calendar sync files
// meetings this way, and so do commit fill blocks and accepted day-assembly
// suggestions. That time is real and counts toward the day, but it is invisible
// to every project report, so it needs a surface. This is it.
//
// Deliberately NOT dismissible, unlike AutoTrackNag: that one nudges you toward
// an optional feature, this one is a worklist of your own unattributed hours.

// The window this nags about now lives with the query (`unfiledWindow`), because
// the Time nav row's badge counts the same list and the two must not drift.
export function UnfiledEntriesBanner({
	todayKey,
	timezone,
}: {
	todayKey: string;
	/** The org's timezone: a meeting's start is shown in it, like every other
	 *  clock time in the app. */
	timezone: string;
}) {
	const heightTransition = useHeightTransition();
	const orgSlug = useOrgSlug();
	const [open, setOpen] = useState(false);
	const { from } = unfiledWindow(todayKey);

	const { data: entries } = useQuery({
		...unfiledWindowQuery(orgSlug, todayKey),
		staleTime: 60_000,
	});

	const count = entries?.length ?? 0;
	const seconds = (entries ?? []).reduce(
		(sum, e) => sum + e.durationSeconds,
		0,
	);
	// When everything on the list came from the calendar, say so: "entries
	// aren't filed" describes the database, "meetings from your calendar need a
	// project" describes what the person is looking at. A mixed list (a
	// rest-of-day block, an accepted suggestion) keeps the general wording.
	const allMeetings = count > 0 && (entries ?? []).every(isCalendarMeeting);

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
							{allMeetings ? (
								<CalendarBlankIcon className="size-4 shrink-0 text-primary" />
							) : (
								<TrayIcon className="size-4 shrink-0 text-primary" />
							)}
							<div className="min-w-0 flex-1">
								<p className="text-base font-medium">
									{allMeetings
										? count === 1
											? "1 meeting from your calendar needs a project"
											: `${count} meetings from your calendar need a project`
										: count === 1
											? "1 entry needs a project"
											: `${count} entries need a project`}
								</p>
								<p className="text-sm text-muted-foreground">
									{allMeetings
										? `Google Calendar added ${formatHoursShort(seconds)} of meetings. Pick the project each one belongs to and its time counts in that project's reports.`
										: `${formatHoursShort(seconds)} of tracked time won't show in any project report until you file it.`}
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
				to={todayKey}
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

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{allMeetings ? "Add your meetings to a project" : "File your time"}
					</DialogTitle>
					<DialogDescription>
						{allMeetings
							? "These came from your Google Calendar. Tick the meetings that belong to a project and add them together. Choose a task only when they need a different one."
							: "Pick the entries that belong to a project and file them together. Choose a task only when they need a different one."}
					</DialogDescription>
				</DialogHeader>

				<div className="-mx-6 flex flex-col divide-y divide-line2 border-y">
					{groups.map((group) => (
						<UnfiledGroupRow
							key={group.key}
							group={group}
							timezone={timezone}
							selectedIds={selectedIds}
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
								disabled={
									selectedIds.size === 0 || !projectId || fileMutation.isPending
								}
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
	onToggleGroup,
	onToggleEntry,
}: {
	group: UnfiledGroup;
	timezone: string;
	selectedIds: Set<string>;
	onToggleGroup: () => void;
	onToggleEntry: (id: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const allIn = group.entries.every((e) => selectedIds.has(e.id));
	const someIn = !allIn && group.entries.some((e) => selectedIds.has(e.id));
	const isRecurring = group.entries.length > 1;
	const first = group.entries[0];

	return (
		<div className="py-1">
			{/* The label is the whole row, not just the box: a 16px checkbox is a
			    hard target, and everything to its right identifies the same group.
			    "Show dates" has to stay OUTSIDE it — a button nested in a label
			    toggles the checkbox on its way to its own handler.

			    Three things in a fixed place, so the eye can run down the list:
			    the box, then what the meeting is (a calendar mark on synced rows,
			    the title, then the task and when it was), then how long, in the
			    mono figure the timesheet uses. */}
			<div className="flex items-center gap-3 pr-6">
				<label
					className={cn(
						"flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md py-2.5 pl-6 transition-colors duration-(--dur-fast) hover:bg-muted",
						allIn && "bg-muted/60",
					)}
				>
					<input
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
					{group.fromCalendar && (
						<CalendarBlankIcon
							className="size-4 shrink-0 text-muted-foreground"
							aria-label="From your Google Calendar"
						/>
					)}
					<span className="min-w-0 flex-1">
						<span className="block truncate text-base font-medium">
							{group.title}
						</span>
						<span className="block text-sm text-muted-foreground">
							{group.taskName}
							{" · "}
							{isRecurring
								? `${group.entries.length} occurrences`
								: first
									? whenLabel(first, timezone)
									: ""}
						</span>
					</span>
					<span className="mono shrink-0 text-base tabular-nums">
						{formatHoursShort(group.seconds)}
					</span>
				</label>
				{isRecurring && (
					<Button
						variant="ghost"
						size="sm"
						className="shrink-0"
						onClick={() => setExpanded((current) => !current)}
					>
						{expanded ? "Hide dates" : "Show dates"}
					</Button>
				)}
			</div>

			{expanded && (
				<div className="mb-2 flex flex-col pl-6">
					{group.entries.map((entry) => (
						<label
							key={entry.id}
							className="flex cursor-pointer items-center gap-3 rounded-md py-1.5 pr-3 pl-8 text-sm text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted"
						>
							<input
								type="checkbox"
								className="size-4 cursor-pointer accent-primary"
								checked={selectedIds.has(entry.id)}
								onChange={() => onToggleEntry(entry.id)}
							/>
							<span className="flex-1">{whenLabel(entry, timezone)}</span>
							<span className="mono tabular-nums">
								{formatHoursShort(entry.durationSeconds)}
							</span>
						</label>
					))}
				</div>
			)}
		</div>
	);
}
