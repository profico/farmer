import { dayKeyInTz, minutesSinceMidnightInTz } from "@farmer/core/lib/time";
import { useEffect, useRef } from "react";
import { AddBlockDialog } from "#/components/time/add-block-dialog.tsx";
import { CalendarBlock } from "#/components/time/calendar-block.tsx";
import type { EntryBlockRowEntry } from "#/components/time/entry-block-row.tsx";
import { groupByDay } from "#/lib/group-by-day.ts";
import { layoutOverlappingBlocks } from "#/lib/layout-overlapping-blocks.ts";
import { cn } from "#/lib/utils.ts";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DEFAULT_SCROLL_HOUR = 8;
const GUTTER_WIDTH = 52;
const BLOCK_GAP_PX = 3;
const EMPTY_HOLIDAYS: Map<string, string> = new Map();

function hourLabel(hour: number): string {
	if (hour === 0) return "12am";
	if (hour === 12) return "12pm";
	return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

function timeLabel(hour: number, minute: number): string {
	const h12 = hour % 12 === 0 ? 12 : hour % 12;
	return minute === 0
		? `${h12}:00`
		: `${h12}:${String(minute).padStart(2, "0")}`;
}

export function CalendarGrid({
	dates,
	entries,
	timezone,
	pxPerHour,
	variant,
	holidays = EMPTY_HOLIDAYS,
}: {
	dates: string[];
	entries: EntryBlockRowEntry[];
	timezone: string;
	pxPerHour: number;
	variant: "day" | "week";
	holidays?: Map<string, string>;
}) {
	const byDate = new Map(groupByDay(entries, timezone));
	const todayKey = dayKeyInTz(new Date(), timezone);
	const scrollRef = useRef<HTMLDivElement>(null);
	const gridHeight = 24 * pxPerHour;

	// biome-ignore lint/correctness/useExhaustiveDependencies: only scroll to the default position once, on mount
	useEffect(() => {
		scrollRef.current?.scrollTo({ top: DEFAULT_SCROLL_HOUR * pxPerHour });
	}, []);

	return (
		<div className="flex h-full flex-col overflow-hidden border-y">
			<div ref={scrollRef} className="min-h-[360px] flex-1 overflow-y-auto">
				<div
					className="grid"
					style={{
						gridTemplateColumns: `${GUTTER_WIDTH}px repeat(${dates.length}, 1fr)`,
					}}
				>
					{dates.length > 1 && (
						<>
							<div className="sticky top-0 z-20 border-b bg-background" />
							{dates.map((date) => {
								const isToday = date === todayKey;
								const holidayName = holidays.get(date);
								const [, , day] = date.split("-");
								const weekday = new Date(
									`${date}T12:00:00Z`,
								).toLocaleDateString("en-US", {
									weekday: "short",
									timeZone: "UTC",
								});
								return (
									<div
										key={date}
										title={holidayName}
										className={cn(
											"sticky top-0 z-20 border-l border-b bg-background py-2 text-center",
											isToday && "bg-accent",
											holidayName && !isToday && "bg-amber-500/10",
										)}
									>
										<div
											className={cn(
												"text-2xs font-semibold tracking-wide uppercase",
												isToday ? "text-primary" : "text-muted-foreground",
											)}
										>
											{weekday}
										</div>
										<div
											className={cn(
												"mt-0.5 text-[15px] font-semibold",
												isToday &&
													"mx-auto flex size-6 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground",
											)}
										>
											{Number(day)}
										</div>
										{holidayName && (
											<div className="truncate px-1 text-2xs font-medium text-amber-700 dark:text-amber-400">
												{holidayName}
											</div>
										)}
									</div>
								);
							})}
						</>
					)}
					<div
						className="relative border-r"
						style={{
							height: gridHeight,
							backgroundImage:
								"linear-gradient(var(--border) 1px, transparent 1px)",
							backgroundSize: `100% ${pxPerHour}px`,
						}}
					>
						{HOURS.map((hour) => (
							<div
								key={hour}
								className="absolute right-1.5 text-2xs text-muted-foreground"
								style={{ top: Math.max(hour * pxPerHour - 6, 2) }}
							>
								{hourLabel(hour)}
							</div>
						))}
					</div>
					{dates.map((date) => (
						<DayColumn
							key={date}
							date={date}
							entries={byDate.get(date) ?? []}
							timezone={timezone}
							pxPerHour={pxPerHour}
							variant={variant}
							isToday={date === todayKey}
							holidayName={holidays.get(date)}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

function DayColumn({
	date,
	entries,
	timezone,
	pxPerHour,
	variant,
	isToday,
	holidayName,
}: {
	date: string;
	entries: EntryBlockRowEntry[];
	timezone: string;
	pxPerHour: number;
	variant: "day" | "week";
	isToday: boolean;
	holidayName?: string;
}) {
	const withPosition = entries.map((entry) => {
		const start = minutesSinceMidnightInTz(new Date(entry.startedAt), timezone);
		return {
			entry,
			startMinutes: start,
			durationMinutes: Math.max(entry.durationSeconds / 60, 1),
		};
	});
	const laidOut = layoutOverlappingBlocks(withPosition);
	const nowMinutes = isToday
		? minutesSinceMidnightInTz(new Date(), timezone)
		: null;
	const dateOptions = [{ value: date, label: date }];

	return (
		<div
			title={holidayName}
			className={cn(
				"relative border-r",
				isToday && variant === "week" && "bg-accent/40",
				holidayName && !isToday && "bg-amber-500/5",
			)}
			style={{
				backgroundImage: "linear-gradient(var(--border) 1px, transparent 1px)",
				backgroundSize: `100% ${pxPerHour}px`,
			}}
		>
			{nowMinutes !== null && (
				<div
					className="absolute right-0 left-0 z-10 h-px bg-destructive"
					style={{ top: (nowMinutes / 60) * pxPerHour }}
				>
					<span className="-top-0.5 absolute left-0 block size-1.5 rounded-full bg-destructive" />
				</div>
			)}
			{laidOut.map(({ item, column, columnCount }) => {
				const { entry, startMinutes, durationMinutes } = item;
				const top = (startMinutes / 60) * pxPerHour;
				const height = Math.max((durationMinutes / 60) * pxPerHour, 18);
				const widthPct = 100 / columnCount;
				const startHour = Math.floor(startMinutes / 60);
				const startMinute = startMinutes % 60;

				return (
					<AddBlockDialog
						key={entry.id}
						timezone={timezone}
						dateOptions={dateOptions}
						entry={entry}
						trigger={
							<CalendarBlock
								entry={entry}
								variant={variant}
								startLabel={timeLabel(startHour, startMinute)}
								style={{
									top,
									height,
									left: `calc(${column * widthPct}% + ${column === 0 ? 4 : BLOCK_GAP_PX / 2}px)`,
									width: `calc(${widthPct}% - ${column === 0 || column === columnCount - 1 ? 4 + BLOCK_GAP_PX / 2 : BLOCK_GAP_PX}px)`,
								}}
							/>
						}
					/>
				);
			})}
		</div>
	);
}
