import { addDaysToKey, dayKeyInTz } from "@farmer/core/lib/time";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	PlusIcon,
	SparkleIcon,
	UmbrellaSimpleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
// `useNavigate` for the toolbar's jump-to-date; no AnimatePresence — the list
// stopped using it (see the note over the rows below).
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { AddBlockDialog } from "#/components/time/add-block-dialog.tsx";
import { AssembleDayDialog } from "#/components/time/assemble-day-dialog.tsx";
import { BookTimeOffDialog } from "#/components/time/book-time-off-dialog.tsx";
import {
	EntryBlockRow,
	type EntryBlockRowEntry,
} from "#/components/time/entry-block-row.tsx";
import {
	returnLinkClass,
	stepperClass,
	TimeToolbar,
} from "#/components/time/time-toolbar.tsx";
import { WeekStrip } from "#/components/time/week-strip.tsx";
import { Button } from "#/components/ui/button.tsx";
import { GhostRow } from "#/components/ui/ghost-row.tsx";
import { formatDateKeyLong } from "#/lib/format-date.ts";
import { formatClock } from "#/lib/format-hours.ts";
import { myTargetsQuery } from "#/queries/compliance.ts";
import { queryKeys } from "#/queries/keys.ts";
import { copyTimeEntriesDay } from "#/server/time-entries.ts";

export function DayView({
	orgSlug,
	date,
	timezone,
	entries,
	weekDates,
	weekEntries,
	holidays,
}: {
	orgSlug: string;
	date: string;
	timezone: string;
	/** This day's entries. */
	entries: EntryBlockRowEntry[];
	/** The seven day keys of the week `date` falls in, for the strip above. */
	weekDates: string[];
	/** Every entry in that week — the strip needs per-day totals, not just today. */
	weekEntries: EntryBlockRowEntry[];
	holidays: Map<string, string>;
}) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	// Read without suspending: the strip's "short" marks are a courtesy, and the
	// day must never wait on them.
	const { data: targets } = useQuery(myTargetsQuery(orgSlug));
	const total = entries.reduce((sum, e) => sum + e.durationSeconds, 0);
	// A fill ("rest of day") block is a catch-all, so it always sorts last; the
	// stable sort otherwise preserves the server's insertion ordering.
	const sortedEntries = [...entries].sort(
		(a, b) => Number(a.fillsDay) - Number(b.fillsDay),
	);
	const today = dayKeyInTz(new Date(), timezone);
	const isToday = date === today;
	const holidayName = holidays.get(date);

	const secondsByDay = new Map<string, number>();
	for (const entry of weekEntries) {
		secondsByDay.set(
			entry.date,
			(secondsByDay.get(entry.date) ?? 0) + entry.durationSeconds,
		);
	}

	// "Copy from previous day" — Harvest's backfill affordance, and the closest
	// honest equivalent to a start/stop timer in a duration-only model.
	const previousDay = addDaysToKey(date, -1);
	const copy = useMutation({
		mutationFn: () =>
			copyTimeEntriesDay({ data: { fromDate: previousDay, toDate: date } }),
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
			// `skipped` is what the copy already found here — say so rather than
			// reporting "Copied 0" for a second click, which reads like a failure.
			if (result.copied === 0) {
				toast.success(
					result.skipped > 0
						? "Already copied — the previous day's entries are all here"
						: "Nothing to copy from the previous day",
				);
				return;
			}
			const noun = result.copied === 1 ? "entry" : "entries";
			toast.success(
				result.skipped > 0
					? `Copied ${result.copied} ${noun}, skipped ${result.skipped} already here`
					: `Copied ${result.copied} ${noun}`,
			);
		},
		onError: (error) => toast.error(error.message ?? "Could not copy"),
	});

	return (
		// No width of its own: Day fills the timesheet island exactly like Week and
		// Month do, so the three tabs are the same page at three zoom levels rather
		// than three differently-sized pages.
		<div className="flex min-h-0 flex-1 flex-col">
			<TimeToolbar
				add={
					<AddBlockDialog
						timezone={timezone}
						defaultDate={date}
						trigger={
							<Button size="sm">
								<PlusIcon weight="regular" className="size-4" />
								Log time
							</Button>
						}
					/>
				}
				prev={
					<Link
						to="/$orgSlug/time"
						params={{ orgSlug }}
						search={{ date: previousDay }}
						className={stepperClass}
						aria-label="Previous day"
					>
						<ArrowLeftIcon weight="regular" className="size-4" />
					</Link>
				}
				label={
					<>
						{formatDateKeyLong(date)}
						{holidayName && (
							<span className="ml-1.5 font-medium text-warn">
								{holidayName}
							</span>
						)}
					</>
				}
				next={
					<Link
						to="/$orgSlug/time"
						params={{ orgSlug }}
						search={{ date: addDaysToKey(date, 1) }}
						className={stepperClass}
						aria-label="Next day"
					>
						<ArrowRightIcon weight="regular" className="size-4" />
					</Link>
				}
				jumpTo={{
					value: date,
					onPick: (picked) =>
						navigate({
							to: "/$orgSlug/time",
							params: { orgSlug },
							search: { date: picked },
						}),
				}}
				returnLink={
					!isToday && (
						<Link
							to="/$orgSlug/time"
							params={{ orgSlug }}
							search={{}}
							className={returnLinkClass}
						>
							Return to today
						</Link>
					)
				}
			>
				<BookTimeOffDialog
					orgSlug={orgSlug}
					defaultDate={date}
					trigger={
						<Button variant="secondary" size="sm">
							<UmbrellaSimpleIcon className="size-4" />
							Time off
						</Button>
					}
				/>
				<AssembleDayDialog
					orgSlug={orgSlug}
					date={date}
					trigger={
						<Button variant="secondary" size="sm">
							<SparkleIcon className="size-4" />
							Assemble my day
						</Button>
					}
				/>
			</TimeToolbar>

			{/* 6A: the day strip is the ONE thing that sticks. The island used to
			    be capped at the viewport with the entries scrolling inside it,
			    which put a scrollbar inside a scrollbar and broke the browser's own
			    scroll restoration. The document scrolls now, like every other page,
			    and the strip alone pins to the top of the frame so you always know
			    which day you are filling. The targets bar above it scrolls away,
			    which is right: it is context, not a control.

			    `bg-background` and the bottom rule are what stop the entries showing
			    through it while they pass underneath. */}
			<div className="sticky top-0 z-20 mt-5 border-b border-line bg-background pt-1">
				<WeekStrip
					orgSlug={orgSlug}
					dates={weekDates}
					activeDate={date}
					secondsByDay={secondsByDay}
					today={dayKeyInTz(new Date(), timezone)}
					dayTargetSeconds={
						targets?.week.targetSeconds == null ? null : targets.daySeconds
					}
					holidays={holidays}
				/>
			</div>

			<div className="mt-4 flex-1">
				{/* No AnimatePresence: a row's delete collapse is owned by the row
				    itself (see EntryBlockRow). Presence only knows that a row left,
				    not why — so stepping to another day, which replaces every entry
				    at once, played the delete animation across the whole list.
				    `key` re-runs the stagger when the day changes, which is the
				    crossfade doing the same job honestly. */}
				<div key={date} className="stagger flex flex-col gap-1.5">
					{sortedEntries.map((entry) => (
						<EntryBlockRow key={entry.id} entry={entry} timezone={timezone} />
					))}
				</div>
				{/* The list ends on the way to add to it, whether or not it has rows:
				    an empty day is a sentence and this same row (DESIGN.md, "Empty
				    and ghost rows"), rather than a centred placeholder with no action
				    on it. */}
				<div className="pt-2.5">
					<AddBlockDialog
						timezone={timezone}
						defaultDate={date}
						trigger={
							<GhostRow hint={sortedEntries.length === 0 ? undefined : "L"}>
								{sortedEntries.length === 0
									? "Nothing logged yet. Log your first block of the day"
									: "Add another entry to this day"}
							</GhostRow>
						}
					/>
				</div>
				{sortedEntries.length > 0 && (
					// Harvest puts the day total under the list rather than over it,
					// so it reads as the sum of what you just scanned.
					<div className="mt-4 flex items-center justify-end gap-3 border-t px-1 py-3.5">
						<span className="eyebrow">Total</span>
						<span className="tnum min-w-14 text-right text-md font-semibold">
							{formatClock(total)}
						</span>
					</div>
				)}
			</div>

			{/* Bleeds like every other rule on this screen. It used to be a bare
			    `border-t pt-4`, so its hairline stopped at the padding while the
			    list's rules directly above it ran to the edge.
			    The negative bottom margin cancels the island's own padding so the
			    bar closes the island the way the sidebar's profile row closes the
			    sidebar — flush to the edge and `--footer-h` tall, which is what
			    lands the two hairlines on the same line. */}
			<div className="-mx-4 -mb-4 flex h-(--footer-h) shrink-0 items-center justify-between gap-3 border-t px-4 sm:-mx-8 sm:-mb-7 sm:px-8">
				<Button
					variant="outline"
					size="sm"
					disabled={copy.isPending}
					onClick={() => copy.mutate()}
				>
					{copy.isPending ? "Copying…" : "Copy from previous day"}
				</Button>
				<span className="eyebrow">
					{entries.length} {entries.length === 1 ? "entry" : "entries"} on this
					day
				</span>
			</div>
		</div>
	);
}
