import {
	datesBetween,
	dayKeyInTz,
	endOfMonthKey,
	weekdayInTz,
} from "@farmer/core/lib/time";
import { UmbrellaSimpleIcon } from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookTimeOffDialog } from "#/components/time/book-time-off-dialog.tsx";
import type { EntryBlockRowEntry } from "#/components/time/entry-block-row.tsx";
import {
	returnLinkClass,
	stepperClass,
	TimeToolbar,
} from "#/components/time/time-toolbar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { formatMonthKey } from "#/lib/format-date.ts";
import { formatClock } from "#/lib/format-hours.ts";
import { groupByDay } from "#/lib/group-by-day.ts";
import { cn } from "#/lib/utils.ts";

// Monday-first, like the week strip and the week grid. The month was the one
// screen in the app that started its week on Sunday, which shifted the weekend
// pair from the right edge to both edges as you moved between the three views.
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** 0=Mon..6=Sun, from the DB/Date convention of 0=Sun..6=Sat. */
const monFirstIndex = (sundayFirst: number) => (sundayFirst + 6) % 7;
const MAX_CHIPS_PER_DAY = 3;

function shiftMonthKey(monthKey: string, delta: number): string {
	const [year, month] = monthKey.split("-").map(Number);
	const total = (year ?? 1970) * 12 + ((month ?? 1) - 1) + delta;
	const newYear = Math.floor(total / 12);
	const newMonth = ((total % 12) + 12) % 12;
	return `${newYear}-${String(newMonth + 1).padStart(2, "0")}`;
}

export function MonthView({
	orgSlug,
	month,
	timezone,
	entries,
	holidays,
}: {
	orgSlug: string;
	month: string;
	timezone: string;
	entries: EntryBlockRowEntry[];
	holidays: Map<string, string>;
}) {
	const navigate = useNavigate();
	const monthStart = `${month}-01`;
	const monthEnd = endOfMonthKey(monthStart);
	const days = datesBetween(monthStart, monthEnd);
	const leadingBlanks = monFirstIndex(weekdayInTz(monthStart, timezone));
	const byDay = new Map(groupByDay(entries));
	const today = dayKeyInTz(new Date(), timezone);
	const weekRows = Math.ceil((leadingBlanks + days.length) / 7);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<TimeToolbar
				prev={
					<Link
						to="/$orgSlug/time/month"
						params={{ orgSlug }}
						search={{ month: shiftMonthKey(month, -1) }}
						className={stepperClass}
						aria-label="Previous month"
					>
						←
					</Link>
				}
				label={formatMonthKey(month)}
				next={
					<Link
						to="/$orgSlug/time/month"
						params={{ orgSlug }}
						search={{ month: shiftMonthKey(month, 1) }}
						className={stepperClass}
						aria-label="Next month"
					>
						→
					</Link>
				}
				jumpTo={{
					value: monthStart,
					onPick: (picked) =>
						navigate({
							to: "/$orgSlug/time/month",
							params: { orgSlug },
							search: { month: picked.slice(0, 7) },
						}),
				}}
				returnLink={
					month !== today.slice(0, 7) && (
						<Link
							to="/$orgSlug/time/month"
							params={{ orgSlug }}
							search={{}}
							className={returnLinkClass}
						>
							Return to this month
						</Link>
					)
				}
			>
				<BookTimeOffDialog
					orgSlug={orgSlug}
					defaultDate={monthStart}
					trigger={
						<Button variant="outline" size="sm">
							<UmbrellaSimpleIcon className="size-4" />
							Time off
						</Button>
					}
				/>
			</TimeToolbar>
			{/* Day and Week close on a footer bar because they have controls to put
			    in one; Month has none, so it would have been a hairline with an
			    empty band under it. The grid runs to the island's bottom edge
			    instead — the island's own radius clips it. */}
			<div className="-mx-4 -mb-4 mt-5 flex min-h-0 flex-1 flex-col overflow-hidden border-t sm:-mx-8 sm:-mb-7">
				{/* The weekday header is the only banded row in the grid; every other
				    division is a hairline, so the calendar reads as ruled paper rather
				    than as a table of boxes. */}
				<div className="grid shrink-0 grid-cols-7 border-b bg-secondary">
					{WEEKDAY_LABELS.map((label) => (
						<div
							key={label}
							className="eyebrow border-r border-line2 py-2 text-center last:border-r-0"
						>
							{label}
						</div>
					))}
				</div>
				{/* Rows have a floor as well as a share: `1fr` alone let a six-week
				    month squeeze its cells until the entry chips inside them had
				    nowhere to go. Below the floor the grid scrolls instead. */}
				<div
					className="scrollbar-stable grid min-h-0 flex-1 grid-cols-7 overflow-y-auto"
					style={{
						gridTemplateRows: `repeat(${weekRows}, minmax(var(--month-row-h), 1fr))`,
					}}
				>
					{Array.from({ length: leadingBlanks }, (_, i) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length blank padding
							key={`blank-${i}`}
							// Untinted: a day outside the month is empty ruled paper, and
							// tinting it competes with the weekend band for the same signal.
							className="border-r border-b border-line2 last:border-r-0"
						/>
					))}
					{days.map((date, i) => {
						const dayEntries = byDay.get(date) ?? [];
						const dayTotal = dayEntries.reduce(
							(sum, e) => sum + e.durationSeconds,
							0,
						);
						const shown = dayEntries.slice(0, MAX_CHIPS_PER_DAY);
						const extra = dayEntries.length - shown.length;
						const isToday = date === today;
						const weekday = weekdayInTz(date, timezone);
						const isWeekend = weekday === 0 || weekday === 6;
						const isLastColumn = (leadingBlanks + i) % 7 === 6;
						const holidayName = holidays.get(date);

						return (
							<Link
								key={date}
								to="/$orgSlug/time"
								params={{ orgSlug }}
								search={{ date }}
								title={holidayName}
								className={cn(
									"overflow-hidden border-r border-b border-line2 p-2 text-left transition-colors duration-(--dur-fast) hover:bg-[var(--sel)]",
									isLastColumn && "border-r-0",
									// Today is marked by a 2px accent bar along its top edge,
									// not a fill — one cell tinted inside a grid of tinted
									// weekends and holidays stops being findable.
									isToday && "border-t-2 border-t-primary",
									holidayName && "bg-warn/8",
									isWeekend && !holidayName && "bg-secondary",
								)}
							>
								<div className="flex items-center justify-between">
									<span
										className={cn(
											"mono text-sm",
											isToday ? "text-primary" : "text-muted-foreground",
										)}
									>
										{Number(date.slice(-2))}
									</span>
									{dayTotal > 0 && (
										<span
											className={cn(
												"mono text-sm",
												isToday ? "text-primary" : "text-foreground",
											)}
										>
											{formatClock(dayTotal)}
										</span>
									)}
								</div>
								{holidayName && (
									<div className="mt-0.5 truncate text-2xs text-warn">
										{holidayName}
									</div>
								)}
								<div className="mt-1.5 space-y-1">
									{shown.map((entry) => (
										<div
											key={entry.id}
											className="flex items-center gap-1.5 truncate text-xs"
										>
											<span
												className="size-1.5 shrink-0 rounded-full"
												style={{
													backgroundColor:
														entry.task.color ?? "var(--muted-foreground)",
												}}
											/>
											<span className="truncate">{entry.task.name}</span>
										</div>
									))}
									{extra > 0 && (
										<div className="text-xs text-faint">+{extra} more</div>
									)}
								</div>
							</Link>
						);
					})}
				</div>
			</div>
		</div>
	);
}
