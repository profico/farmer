import { addDaysToKey, dayKeyInTz } from "@farmer/core/lib/time";
import { PlusIcon, SparkleIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { EmptyState } from "#/components/states/empty-state.tsx";
import { AddBlockDialog } from "#/components/time/add-block-dialog.tsx";
import { AssembleDayDialog } from "#/components/time/assemble-day-dialog.tsx";
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
import { formatDateKeyLong } from "#/lib/format-date.ts";
import { formatClock } from "#/lib/format-hours.ts";
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
	const total = entries.reduce((sum, e) => sum + e.durationSeconds, 0);
	// A fill ("rest of day") block is a catch-all, so it always sorts last; the
	// stable sort otherwise preserves the server's insertion ordering.
	const sortedEntries = [...entries].sort(
		(a, b) => Number(a.fillsDay) - Number(b.fillsDay),
	);
	const dateOptions = [{ value: date, label: formatDateKeyLong(date) }];
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
				queryKey: [...queryKeys.timeEntries],
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
		<div className="flex h-full flex-col">
			<TimeToolbar
				add={
					<AddBlockDialog
						timezone={timezone}
						dateOptions={dateOptions}
						trigger={
							<Button size="icon" aria-label="Log time">
								<PlusIcon weight="regular" className="size-4" />
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
						←
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
						→
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
				<AssembleDayDialog
					orgSlug={orgSlug}
					date={date}
					trigger={
						<Button variant="outline" size="sm">
							<SparkleIcon className="size-4" />
							Assemble my day
						</Button>
					}
				/>
			</TimeToolbar>

			<div className="mt-4">
				<WeekStrip
					orgSlug={orgSlug}
					dates={weekDates}
					activeDate={date}
					secondsByDay={secondsByDay}
					holidays={holidays}
				/>
			</div>

			<div className="scrollbar-stable -mx-4 min-h-0 flex-1 overflow-y-auto sm:-mx-8">
				{sortedEntries.length === 0 ? (
					<EmptyState
						title="Nothing logged yet"
						description="Add a block, or copy yesterday's, to start the day."
					/>
				) : (
					<>
						<div className="divide-y divide-line2">
							{/* `initial={false}` so the list doesn't animate on mount —
							    rows only animate on the way *out*. See EntryBlockRow. */}
							<AnimatePresence initial={false}>
								{sortedEntries.map((entry) => (
									<EntryBlockRow
										key={entry.id}
										entry={entry}
										timezone={timezone}
										dateOptions={dateOptions}
									/>
								))}
							</AnimatePresence>
						</div>
						{/* Harvest puts the day total under the list rather than over it,
						    so it reads as the sum of what you just scanned. */}
						<div className="flex items-center justify-end gap-3 border-t px-4 py-3.5 sm:px-8">
							<span className="eyebrow">Total</span>
							<span className="mono min-w-14 text-right text-md">
								{formatClock(total)}
							</span>
							{/* Aligns with the row actions above it. */}
							<span className="w-[136px] shrink-0" aria-hidden />
						</div>
					</>
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
