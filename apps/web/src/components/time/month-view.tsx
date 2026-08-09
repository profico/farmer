import {
	datesBetween,
	dayKeyInTz,
	endOfMonthKey,
	weekdayInTz,
} from "@farmer/core/lib/time";
import { Link } from "@tanstack/react-router";
import type { EntryBlockRowEntry } from "#/components/time/entry-block-row.tsx";
import { Button } from "#/components/ui/button.tsx";
import { formatMonthKey } from "#/lib/format-date.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";
import { groupByDay } from "#/lib/group-by-day.ts";
import { cn } from "#/lib/utils.ts";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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
	const monthStart = `${month}-01`;
	const monthEnd = endOfMonthKey(monthStart);
	const days = datesBetween(monthStart, monthEnd);
	const leadingBlanks = weekdayInTz(monthStart, timezone);
	const byDay = new Map(groupByDay(entries, timezone));
	const today = dayKeyInTz(new Date(), timezone);
	const weekRows = Math.ceil((leadingBlanks + days.length) / 7);

	return (
		<div className="flex h-full flex-col">
			<div className="flex shrink-0 items-center justify-between">
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="icon-sm"
						nativeButton={false}
						render={
							<Link
								to="/$orgSlug/time/month"
								params={{ orgSlug }}
								search={{ month: shiftMonthKey(month, -1) }}
							>
								‹
							</Link>
						}
					/>
					<h2 className="min-w-[110px] text-center text-[13px] font-semibold">
						{formatMonthKey(month)}
					</h2>
					<Button
						variant="outline"
						size="icon-sm"
						nativeButton={false}
						render={
							<Link
								to="/$orgSlug/time/month"
								params={{ orgSlug }}
								search={{ month: shiftMonthKey(month, 1) }}
							>
								›
							</Link>
						}
					/>
					<Button
						variant="outline"
						size="sm"
						nativeButton={false}
						render={
							<Link to="/$orgSlug/time/month" params={{ orgSlug }} search={{}}>
								Today
							</Link>
						}
					/>
				</div>
			</div>
			<div className="-mx-4 mt-4 flex min-h-0 flex-1 flex-col overflow-hidden border-y sm:-mx-8">
				<div className="grid shrink-0 grid-cols-7 border-b bg-muted/30">
					{WEEKDAY_LABELS.map((label) => (
						<div
							key={label}
							className="border-r py-2 text-center text-2xs font-semibold tracking-wide text-muted-foreground uppercase last:border-r-0"
						>
							{label}
						</div>
					))}
				</div>
				<div
					className="grid min-h-0 flex-1 grid-cols-7"
					style={{ gridTemplateRows: `repeat(${weekRows}, minmax(0, 1fr))` }}
				>
					{Array.from({ length: leadingBlanks }, (_, i) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length blank padding
							key={`blank-${i}`}
							className="border-r border-b bg-muted/10 last:border-r-0"
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
									"overflow-hidden border-r border-b p-2 text-left hover:bg-accent",
									isLastColumn && "border-r-0",
									isToday && "bg-accent ring-1 ring-inset ring-primary",
									holidayName && !isToday && "bg-amber-500/10",
									isWeekend && !isToday && !holidayName && "bg-muted/40",
								)}
							>
								<div className="flex items-center justify-between">
									<span
										className={cn(
											"text-sm font-medium",
											isToday &&
												"flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground",
										)}
									>
										{Number(date.slice(-2))}
									</span>
									{dayTotal > 0 && (
										<span
											className={cn(
												"text-xs",
												isToday
													? "font-semibold text-primary"
													: "text-muted-foreground",
											)}
										>
											{formatHoursShort(dayTotal)}
										</span>
									)}
								</div>
								{holidayName && (
									<div className="truncate text-2xs font-medium text-amber-700 dark:text-amber-400">
										{holidayName}
									</div>
								)}
								<div className="mt-1 space-y-0.5">
									{shown.map((entry) => (
										<div
											key={entry.id}
											className="flex items-center gap-1 truncate text-xs"
										>
											<span
												className="size-1.5 shrink-0 rounded-full"
												style={{
													backgroundColor:
														entry.type.color ?? "var(--muted-foreground)",
												}}
											/>
											<span className="truncate">{entry.type.name}</span>
										</div>
									))}
									{extra > 0 && (
										<div className="text-xs text-muted-foreground">
											+{extra} more
										</div>
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
