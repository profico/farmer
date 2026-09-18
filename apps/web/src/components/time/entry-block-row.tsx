import { parseDuration, snapToQuarterHour } from "@farmer/core/lib/time";
import {
	CalendarDotIcon,
	GitCommitIcon,
	GitPullRequestIcon,
} from "@phosphor-icons/react";
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
import { Input } from "#/components/ui/input.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { formatDateKeyShort } from "#/lib/format-date.ts";
import { formatClock } from "#/lib/format-hours.ts";
import { useHeightTransition } from "#/lib/motion.ts";
import { cn } from "#/lib/utils.ts";
import { queryKeys } from "#/queries/keys.ts";
import {
	createTimeEntry,
	deleteTimeEntry,
	setTimeEntryOvertime,
	updateTimeEntryDescription,
	updateTimeEntryDuration,
	useCalendarValues,
} from "#/server/time-entries.ts";

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
};

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

/** The pill's text: the calendar's day, its length, or both. */
function calendarLabel(
	diff: NonNullable<ReturnType<typeof calendarDifference>>,
) {
	const parts: string[] = [];
	if (diff.date) parts.push(formatDateKeyShort(diff.date));
	if (diff.durationSeconds != null)
		parts.push(formatClock(diff.durationSeconds));
	return parts.join(" · ");
}

/** The pill's hover text: the whole sentence, and what clicking does. */
function calendarSentence(
	diff: NonNullable<ReturnType<typeof calendarDifference>>,
) {
	const what =
		diff.date && diff.durationSeconds != null
			? `${formatClock(diff.durationSeconds)} on ${formatDateKeyShort(diff.date)}`
			: diff.date
				? `on ${formatDateKeyShort(diff.date)}`
				: `${formatClock(diff.durationSeconds ?? 0)} long`;
	return `On your calendar this meeting is ${what}. Click to use the calendar's day and length.`;
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
	className,
}: {
	entry: EntryBlockRowEntry;
	timezone: string;
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
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not save duration");
			setDuration(formatClock(entry.durationSeconds));
		},
	});

	const saveDuration = () => {
		setEditingDuration(false);
		const trimmed = duration.trim();
		// An emptied box is an abandoned edit, not a request to log nothing —
		// deleting an entry is the Delete button, and a zero-length one cannot
		// exist. Same for a cleared-then-retyped value that comes back unchanged.
		if (trimmed === "") {
			setDuration(formatClock(entry.durationSeconds));
			return;
		}
		const parsed = parseDuration(trimmed);
		if (parsed == null || parsed <= 0) {
			// Said out loud rather than reverted in silence. The grid cell next door
			// can revert quietly because a wrong cell sits in a field of right ones;
			// a single figure snapping back on its own reads as the app ignoring the
			// edit. The hint is the dialog's, word for word.
			toast.error("Could not read that duration — try 1.5, 1h30m or 1:30");
			setDuration(formatClock(entry.durationSeconds));
			return;
		}
		const snapped = snapToQuarterHour(parsed);
		// Show the snap even when the length did not change, so typing "1h20m"
		// against an hour and a half does not look like nothing happened.
		setDuration(formatClock(snapped));
		if (snapped === entry.durationSeconds) return;
		durationMutation.mutate(snapped);
	};

	const calendarDiff = calendarDifference(entry);
	const calendarMutation = useMutation({
		mutationFn: () => useCalendarValues({ data: { timeEntryId: entry.id } }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not take the calendar's values");
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

	return (
		// Wraps in a narrow column. The figure and the three word-buttons are a
		// fixed ~180px; holding them on the same line as the text squeezed a
		// project name down to a dozen characters and turned every note into a
		// five-line column, so under 28rem they drop to their own right-aligned
		// line.
		//
		// That 28rem is the LIST's width (`@container/entries`, declared by the
		// two lists that render this row), not the window's. On the viewport this
		// was `sm:`, which is 640px of window — but on the home page the list is
		// two thirds of the page, which is itself the window minus the nav column,
		// so a 1024px window handed this row 470px and the rule read it as wide.
		// The result was the shape the rule exists to prevent: "[BDT] …" beside a
		// full row of buttons.
		//
		// The INSET stays on the viewport (`px-4 sm:px-8`). It is the island's own
		// padding rather than anything about this row, and every band on the page
		// shares it.
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
		// `prefers-reduced-motion` is NOT covered by the root
		// <MotionConfig reducedMotion="user"> here: it drops transform, scale and
		// slide, and this collapse is height and padding. `useHeightTransition`
		// is what answers the preference — see `lib/motion.ts`.
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
					{/* A synced meeting the person moved or re-lengthed: the calendar's
					    value, as a pill in the slot "Overtime" uses, and the pill is the
					    button that takes it. Absent on every meeting that simply follows
					    the calendar, so its presence means something. */}
					{calendarDiff && (
						<button
							type="button"
							onClick={() => calendarMutation.mutate()}
							disabled={calendarMutation.isPending}
							title={calendarSentence(calendarDiff)}
							className="eyebrow flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-warn/12 px-1.5 py-0.5 text-warn transition-colors duration-(--dur-fast) hover:bg-warn/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
						>
							<CalendarDotIcon className="size-3" />
							Calendar: {calendarLabel(calendarDiff)}
						</button>
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
				{entry.project && (
					<p className="text-sm text-muted-foreground">{entry.task.name}</p>
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
			<div className="flex w-full shrink-0 items-center justify-end gap-1 @md/entries:w-auto @md/entries:items-start @md/entries:gap-3">
				{/* A fill block's length is the day's leftover working time, recomputed
				    on every write, so there is nothing here to type into — it stays a
				    figure. Everything else is editable in place, like the note. */}
				{entry.fillsDay ? (
					<span
						className="mono mr-auto px-1.5 text-base @md/entries:mt-0.5 @md/entries:mr-0"
						title="This block fills the rest of the day, so its length follows the day"
					>
						{formatClock(entry.durationSeconds)}
					</span>
				) : (
					<Input
						value={duration}
						onFocus={() => setEditingDuration(true)}
						onChange={(event) => setDuration(event.target.value)}
						onBlur={saveDuration}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								event.currentTarget.blur();
								return;
							}
							if (event.key === "Escape") {
								setEditingDuration(false);
								setDuration(formatClock(entry.durationSeconds));
								event.currentTarget.blur();
							}
						}}
						inputMode="decimal"
						aria-label={`Duration — ${entryHeading(entry)}`}
						className="mono mr-auto h-7 w-16 shrink-0 rounded-md border-transparent px-1.5 text-right text-base hover:not-disabled:not-focus-visible:border-input focus-visible:bg-background @md/entries:mr-0"
					/>
				)}
				{/* Overtime is a one-click toggle from the row: it is purely manual, and
				    making people reopen the dialog for it guarantees it never gets set. */}
				{!entry.task.isAbsence && !entry.fillsDay && (
					<Button
						variant="ghost"
						size="sm"
						className={cn("text-faint", entry.overtime && "text-warn")}
						onClick={() => overtimeMutation.mutate(!entry.overtime)}
						disabled={overtimeMutation.isPending}
					>
						OT
					</Button>
				)}
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
