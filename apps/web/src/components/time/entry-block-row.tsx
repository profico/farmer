import { GitCommitIcon, GitPullRequestIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
	AddBlockDialog,
	type ExistingTimeEntry,
} from "#/components/time/add-block-dialog.tsx";
import { EntryMark } from "#/components/time/entry-mark.tsx";
import { Button } from "#/components/ui/button.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { formatDateKeyShort } from "#/lib/format-date.ts";
import { formatClock } from "#/lib/format-hours.ts";
import { useHeightTransition } from "#/lib/motion.ts";
import {
	type DeletedTimeEntry,
	isRestorable,
	restoreTimeEntries,
} from "#/lib/restore-time-entries.ts";
import { cn } from "#/lib/utils.ts";
import { queryKeys } from "#/queries/keys.ts";
import { invalidateTimer } from "#/queries/timer.ts";
import {
	acknowledgeCalendarChange,
	deleteTimeEntry,
	setTimeEntryOvertime,
	updateTimeEntryDescription,
	updateTimeEntryDuration,
	useCalendarValues,
} from "#/server/time-entries.ts";
import { startTimer } from "#/server/timer.ts";

import {
	errorMessage,
	isWorkEntry,
	noteChanged,
	noteView,
	readDurationEdit,
} from "./entry-block-row-helpers.ts";
import {
	CalendarChangePill,
	CalendarDiffPill,
	CalendarOriginMark,
	DurationCell,
	ExpandNoteButton,
	LinkedCountBadge,
	NoteField,
	OvertimeButton,
	StartButton,
} from "./entry-block-row-parts.tsx";

export type EntryBlockRowEntry = ExistingTimeEntry & {
	project: {
		name: string;
		code: string | null;
		icon: string | null;
		client: { name: string } | null;
	} | null;
	task: { name: string; color: string | null; isAbsence: boolean };
	commitCount?: number;
	pullRequestCount?: number;
	// A synced meeting carries what the calendar last said its day and length
	// were. Where the entry differs, the person changed it, and the row says so.
	calendarEventId?: string | null;
	syncedDate?: string | null;
	syncedDurationSeconds?: number | null;
	syncedDescription?: string | null;
	/** When the meeting starts, per the calendar. Display only. */
	meetingStartsAt?: Date | string | null;
	/** The sync changed the day, length or title on the calendar's say-so, and
	 *  what the entry said before it did — **one key per field it changed, and
	 *  no others**. Cleared when dismissed. */
	calendarChangedAt?: Date | string | null;
	calendarChangeFrom?: {
		date?: string;
		durationSeconds?: number;
		description?: string;
	} | null;
};

/** The sentences behind the "Updated by calendar" pill: each field the sync
 *  changed, as "was X".
 *
 *  Read, never compared. `calendarChangeFrom` carries a key only for a field
 *  that write changed, so the keys present ARE the sentences — and a field
 *  the person owns is absent from it. Comparing was the old way and it had no
 *  right answer: against the baseline (the calendar's latest word, which moves
 *  on under a field the person owns) it announced "Moved from Thu" on an entry
 *  still sitting on Thursday; against the entry it would blame the calendar
 *  for the person's own next edit. */
export function calendarChangeSentences(entry: EntryBlockRowEntry): string[] {
	const from = entry.calendarChangeFrom;
	if (!from) return [];
	const out: string[] = [];
	if (from.date != null) {
		out.push(`Moved from ${formatDateKeyShort(from.date)}`);
	}
	if (from.durationSeconds != null) {
		out.push(`Was ${formatClock(from.durationSeconds)} long`);
	}
	// A meeting the calendar imported untitled has nothing to quote.
	if (from.description) {
		out.push(`Was called "${from.description}"`);
	}
	return out;
}

/** What the calendar says about a synced meeting that the person has since
 *  moved or re-lengthed, or null when the entry still matches the calendar
 *  (or is not a synced meeting). The note is deliberately not compared: a note
 *  is the person's from the moment they write one, and flagging every meeting
 *  with a note would make the pill mean nothing. */
export function calendarDifference(entry: EntryBlockRowEntry): {
	date: string | null;
	durationSeconds: number | null;
} | null {
	if (
		entry.calendarEventId == null ||
		entry.syncedDate == null ||
		entry.syncedDurationSeconds == null
	) {
		return null;
	}
	const date = entry.syncedDate !== entry.date ? entry.syncedDate : null;
	const durationSeconds =
		entry.syncedDurationSeconds !== entry.durationSeconds
			? entry.syncedDurationSeconds
			: null;
	if (date === null && durationSeconds === null) return null;
	return { date, durationSeconds };
}

/** Harvest's row heading: "[CODE] Project (Client)". The code is what people
 *  actually say out loud, so it leads; an absence has neither and just names
 *  itself. */
export function entryHeading(entry: EntryBlockRowEntry): string {
	if (!entry.project) return entry.task.name;
	const code = entry.project.code ? `[${entry.project.code}] ` : "";
	const client = entry.project.client ? ` (${entry.project.client.name})` : "";
	return `${code}${entry.project.name}${client}`;
}

export function EntryBlockRow({
	entry,
	timezone,
	timing = false,
	className,
}: {
	entry: EntryBlockRowEntry;
	timezone: string;
	/**
	 * True while a timer is adding to this entry (issue #107). The list reads
	 * it once through `useTimedEntryId` (`hooks/use-timer.ts`) and passes it
	 * down, so no row subscribes to the timer on its own.
	 */
	timing?: boolean;
	/**
	 * Layout only, and in practice only the row's inset. The row is built for a
	 * full-bleed list and carries the island's own padding (`px-4 sm:px-8`), so
	 * a list that is one COLUMN of a grid rather than the page's whole width —
	 * the home page's — passes the matching negative margin (`-mx-4 sm:-mx-8`)
	 * to bleed the fill back out to the island's edge while the text stays on
	 * the column. `cn` is tailwind-merge, so a padding passed here really does
	 * replace the pair.
	 */
	className?: string;
}) {
	const heightTransition = useHeightTransition();
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
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).timeEntries],
				}),
				invalidateTimer(queryClient, orgSlug),
			]);
		},
		onError: (error) => {
			toast.error(errorMessage(error, "Could not save note"));
			setNote(entry.description ?? "");
		},
	});

	// A long note is cut at a fixed number of CHARACTERS and opened with "Show
	// more". A line clamp cannot do this job on the field itself: `line-clamp`
	// works on line boxes in a block, and a textarea's value is not laid out as
	// ones it can reach — with `field-sizing: content` a twenty-line note grew
	// the row to twenty lines. So reading and editing are separate: a button
	// holds the (possibly cut) note and swaps to the textarea on click.
	const [expanded, setExpanded] = useState(false);
	const [editing, setEditing] = useState(false);
	const { isLong, shownNote } = noteView(note, expanded);

	const saveNote = () => {
		if (!noteChanged(note, entry.description)) return;
		noteMutation.mutate(note.trimEnd());
	};

	// Inline duration editing, the note field's twin: a local draft, committed on
	// blur. Synced from the server value only while the box is idle, or a
	// refetch landing mid-edit would rewrite what is being typed.
	const [duration, setDuration] = useState(formatClock(entry.durationSeconds));
	const [editingDuration, setEditingDuration] = useState(false);
	useEffect(() => {
		if (!editingDuration) setDuration(formatClock(entry.durationSeconds));
	}, [entry.durationSeconds, editingDuration]);

	const durationMutation = useMutation({
		mutationFn: (durationSeconds: number) =>
			updateTimeEntryDuration({
				data: { timeEntryId: entry.id, durationSeconds },
			}),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).timeEntries],
				}),
				invalidateTimer(queryClient, orgSlug),
			]);
		},
		onError: (error) => {
			toast.error(errorMessage(error, "Could not save duration"));
			setDuration(formatClock(entry.durationSeconds));
		},
	});

	const saveDuration = () => {
		setEditingDuration(false);
		const edit = readDurationEdit(duration, entry.durationSeconds);
		// An emptied box is an abandoned edit, not a request to log nothing —
		// deleting an entry is the Delete button, and a zero-length one cannot
		// exist. Same for a cleared-then-retyped value that comes back unchanged.
		if (edit.kind === "abandon") {
			setDuration(formatClock(entry.durationSeconds));
			return;
		}
		if (edit.kind === "invalid") {
			// Said out loud rather than reverted in silence. The grid cell next door
			// can revert quietly because a wrong cell sits in a field of right ones;
			// a single figure snapping back on its own reads as the app ignoring the
			// edit. The hint is the dialog's, word for word.
			toast.error("Could not read that duration — try 1.5, 1h30m or 1:30");
			setDuration(formatClock(entry.durationSeconds));
			return;
		}
		// Show the snap even when the length did not change, so typing "1h20m"
		// against an hour and a half does not look like nothing happened.
		setDuration(formatClock(edit.snapped));
		if (edit.kind === "unchanged") return;
		durationMutation.mutate(edit.snapped);
	};

	const calendarChanges = calendarChangeSentences(entry);
	const acknowledgeMutation = useMutation({
		mutationFn: () =>
			acknowledgeCalendarChange({ data: { timeEntryId: entry.id } }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
		},
		onError: (error) => {
			toast.error(errorMessage(error, "Could not dismiss the notice"));
		},
	});

	const calendarDiff = calendarDifference(entry);
	const calendarMutation = useMutation({
		mutationFn: () => useCalendarValues({ data: { timeEntryId: entry.id } }),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).timeEntries],
				}),
				invalidateTimer(queryClient, orgSlug),
			]);
		},
		onError: (error) => {
			toast.error(errorMessage(error, "Could not take the calendar's values"));
		},
	});

	// Continue this entry on the stopwatch (issue #107), the way Harvest restarts
	// a row: the timer measures on top of what the entry holds and saves over
	// it when stopped. Whether it already does is `timing`, from the list.
	const continuable = isWorkEntry(entry);
	const continueMutation = useMutation({
		mutationFn: () => startTimer({ data: { timeEntryId: entry.id } }),
		onSuccess: async () => {
			await invalidateTimer(queryClient, orgSlug);
		},
		onError: (error) => {
			toast.error(errorMessage(error, "Could not start the timer"));
		},
	});

	const overtimeMutation = useMutation({
		mutationFn: (overtime: boolean) =>
			setTimeEntryOvertime({ data: { timeEntryId: entry.id, overtime } }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
		},
		onError: (error) => {
			toast.error(errorMessage(error, "Could not update overtime"));
		},
	});

	// Re-creates a just-deleted entry from its server snapshot, used by the undo
	// toast. The copy itself is `lib/restore-time-entries.ts`, shared with the
	// unfiled-entries dialog, which deletes the same rows from its own list.
	const restore = async (deleted: DeletedTimeEntry) => {
		try {
			await restoreTimeEntries([deleted]);
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
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).timeEntries],
				}),
				invalidateTimer(queryClient, orgSlug),
			]);
			// `isRestorable` says which rows undo can put back, and why — a fill
			// block and a rule-generated entry cannot, a calendar meeting can.
			if (deleted && isRestorable(deleted)) {
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
			toast.error(errorMessage(error, "Could not delete time entry"));
		},
	});

	return (
		// Under 28rem the figure and the word-buttons (about 250px) wrap to their
		// own right-aligned line. On the same line they squeeze the project name.
		//
		// The 28rem is the width of the list (`@container/entries`, declared by
		// the two lists that render this row), not of the window. The list is
		// narrower than the window, so a viewport breakpoint reads the row as wide
		// too early. The inset stays on the viewport (`px-4 sm:px-8`), because
		// every band on the page shares it.
		//
		// Delete collapses the row, so the "Undo" toast stays tied to the row it
		// restores. There is no matching enter, because a new row arrives as its
		// dialog closes. The collapse and the delete start together: the request
		// never waits for the animation.
		//
		// `overflow-hidden` makes the collapse read as the row closing. The root
		// <MotionConfig reducedMotion="user"> does not cover this collapse (it
		// animates height and padding). `useHeightTransition` answers
		// `prefers-reduced-motion` (`lib/motion.ts`).
		<motion.div
			animate={
				collapsing
					? { height: 0, opacity: 0, paddingTop: 0, paddingBottom: 0 }
					: undefined
			}
			transition={heightTransition}
			className={cn(
				"group/entry flex flex-wrap items-start gap-x-3 gap-y-1 overflow-hidden px-4 py-3 transition-colors duration-(--dur-fast) hover:bg-muted @md/entries:flex-nowrap sm:px-8",
				className,
			)}
		>
			<EntryMark
				project={entry.project}
				taskColor={entry.task.color}
				className="mt-0.5"
			/>
			<div className="min-w-0 flex-1">
				{/* Project line, then task line, then the note — Harvest's three-tier
				    row. The hierarchy is load-bearing: you scan for the project, then
				    confirm the task, and only read the note if you need detail. */}
				<div className="flex flex-wrap items-center gap-2">
					<p className="truncate text-base font-medium">
						{entryHeading(entry)}
					</p>
					{entry.calendarEventId != null && (
						<CalendarOriginMark entry={entry} timezone={timezone} />
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
					{/* Absent on every meeting that simply follows the calendar, so its
					    presence means something. */}
					{calendarDiff && (
						<CalendarDiffPill
							entry={entry}
							diff={calendarDiff}
							pending={calendarMutation.isPending}
							onUse={() => calendarMutation.mutate()}
						/>
					)}
					{calendarChanges.length > 0 && (
						<CalendarChangePill
							lines={calendarChanges}
							changedAt={entry.calendarChangedAt}
							timezone={timezone}
							pending={acknowledgeMutation.isPending}
							onAcknowledge={() => acknowledgeMutation.mutate()}
						/>
					)}
					<LinkedCountBadge
						count={entry.commitCount}
						noun="commit"
						icon={<GitCommitIcon className="size-3" />}
					/>
					<LinkedCountBadge
						count={entry.pullRequestCount}
						noun="pull request"
						icon={<GitPullRequestIcon className="size-3" />}
					/>
				</div>
				{entry.project && (
					<p className="text-sm text-muted-foreground">{entry.task.name}</p>
				)}
				<NoteField
					note={note}
					shownNote={shownNote}
					editing={editing}
					onChange={setNote}
					onStartEdit={() => setEditing(true)}
					onBlur={() => {
						saveNote();
						setEditing(false);
					}}
					onEscape={() => {
						setNote(entry.description ?? "");
						setEditing(false);
					}}
				/>
				{!editing && isLong && (
					<ExpandNoteButton
						expanded={expanded}
						onToggle={() => setExpanded((open) => !open)}
					/>
				)}
			</div>
			<div className="flex w-full shrink-0 items-center justify-end gap-1 @md/entries:w-auto @md/entries:items-start @md/entries:gap-3">
				<DurationCell
					fillsDay={entry.fillsDay}
					seconds={entry.durationSeconds}
					value={duration}
					label={`Duration — ${entryHeading(entry)}`}
					onFocus={() => setEditingDuration(true)}
					onChange={setDuration}
					onBlur={saveDuration}
					onCancel={() => {
						setEditingDuration(false);
						setDuration(formatClock(entry.durationSeconds));
					}}
				/>
				<OvertimeButton
					available={continuable}
					overtime={entry.overtime}
					pending={overtimeMutation.isPending}
					onToggle={() => overtimeMutation.mutate(!entry.overtime)}
				/>
				<StartButton
					available={continuable}
					timing={timing}
					pending={continueMutation.isPending}
					onStart={() => continueMutation.mutate()}
				/>
				<AddBlockDialog
					timezone={timezone}
					defaultDate={entry.date}
					entry={entry}
					trigger={
						<Button variant="ghost" size="sm" className="text-faint">
							Edit
						</Button>
					}
				/>
				<Button
					variant="ghost"
					size="sm"
					className="text-faint hover:text-destructive"
					onClick={() => {
						setCollapsing(true);
						deleteMutation.mutate();
					}}
					disabled={deleteMutation.isPending}
				>
					Delete
				</Button>
			</div>
		</motion.div>
	);
}
