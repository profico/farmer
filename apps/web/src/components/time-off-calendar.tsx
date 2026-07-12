import {
	addDaysToKey,
	dayKeyInTz,
	endOfMonthKey,
	startOfMonthKey,
	startOfWeekKey,
} from "@farmer/core/lib/time";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button.tsx";
import { holidaysForRangeQuery } from "#/queries/holidays.ts";
import { myTimeOffQuery } from "#/queries/time-off.ts";
import { cn } from "#/lib/utils.ts";

export type DateRange = { startDate: string; endDate: string };

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const utcWeekday = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();
const dayOfMonth = (key: string) => Number(key.slice(8, 10));

// Build the 6-week (42-day) grid covering the month that `monthKey` falls in,
// Monday-first to match the rest of the app.
const buildGrid = (monthKey: string): string[] => {
	const gridStart = startOfWeekKey(startOfMonthKey(monthKey));
	return Array.from({ length: 42 }, (_, i) => addDaysToKey(gridStart, i));
};

export function TimeOffCalendar({
	timezone,
	value,
	onChange,
}: {
	timezone: string;
	value: DateRange | null;
	onChange: (range: DateRange) => void;
}) {
	const todayKey = dayKeyInTz(new Date(), timezone);
	const [monthKey, setMonthKey] = useState(
		startOfMonthKey(value?.startDate ?? todayKey),
	);
	// When only a start is picked, the next click sets the end.
	const [pendingStart, setPendingStart] = useState<string | null>(null);

	const grid = useMemo(() => buildGrid(monthKey), [monthKey]);
	const gridFrom = grid[0] ?? monthKey;
	const gridTo = grid[grid.length - 1] ?? monthKey;

	const { data: holidayEntries = [] } = useQuery(
		holidaysForRangeQuery({ from: gridFrom, to: gridTo }),
	);
	const holidayByKey = useMemo(
		() => new Map(holidayEntries),
		[holidayEntries],
	);

	const { data: myRequests = [] } = useQuery(myTimeOffQuery());
	const existingKeys = useMemo(() => {
		const set = new Set<string>();
		for (const r of myRequests) {
			if (r.status === "denied") continue;
			let cursor = r.startDate;
			while (cursor <= r.endDate) {
				set.add(cursor);
				cursor = addDaysToKey(cursor, 1);
			}
		}
		return set;
	}, [myRequests]);

	const monthLabel = new Date(`${monthKey}T00:00:00Z`).toLocaleDateString(
		"en-US",
		{ month: "long", year: "numeric", timeZone: "UTC" },
	);
	const currentMonth = monthKey.slice(0, 7);

	const inSelected = (key: string) =>
		value && key >= value.startDate && key <= value.endDate;

	const handleClick = (key: string) => {
		if (pendingStart === null) {
			setPendingStart(key);
			onChange({ startDate: key, endDate: key });
			return;
		}
		const start = key < pendingStart ? key : pendingStart;
		const end = key < pendingStart ? pendingStart : key;
		setPendingStart(null);
		onChange({ startDate: start, endDate: end });
	};

	return (
		<div className="rounded-lg border p-3">
			<div className="mb-2 flex items-center justify-between">
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					onClick={() =>
						setMonthKey(startOfMonthKey(addDaysToKey(monthKey, -1)))
					}
					aria-label="Previous month"
				>
					<ChevronLeft className="size-4" />
				</Button>
				<span className="text-sm font-medium">{monthLabel}</span>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					onClick={() =>
						setMonthKey(startOfMonthKey(addDaysToKey(endOfMonthKey(monthKey), 1)))
					}
					aria-label="Next month"
				>
					<ChevronRight className="size-4" />
				</Button>
			</div>
			<div className="grid grid-cols-7 gap-0.5 text-center text-2xs text-muted-foreground">
				{WEEKDAY_LABELS.map((label) => (
					<div key={label} className="py-1">
						{label}
					</div>
				))}
			</div>
			<div className="grid grid-cols-7 gap-0.5">
				{grid.map((key) => {
					const weekday = utcWeekday(key);
					const isWeekend = weekday === 0 || weekday === 6;
					const isHoliday = holidayByKey.has(key);
					const isOtherMonth = key.slice(0, 7) !== currentMonth;
					const selected = inSelected(key);
					const isExisting = existingKeys.has(key) && !selected;
					const isToday = key === todayKey;
					return (
						<button
							key={key}
							type="button"
							onClick={() => handleClick(key)}
							title={holidayByKey.get(key)}
							className={cn(
								"relative flex h-9 items-center justify-center rounded-md text-sm transition-colors",
								isOtherMonth && "text-muted-foreground/50",
								(isWeekend || isHoliday) && !selected && "bg-muted/60",
								isExisting &&
									"ring-1 ring-inset ring-amber-400/60 dark:ring-amber-500/40",
								selected
									? "bg-primary text-primary-foreground"
									: "hover:bg-accent",
							)}
						>
							{dayOfMonth(key)}
							{isHoliday && !selected && (
								<span className="absolute bottom-1 size-1 rounded-full bg-rose-400" />
							)}
							{isToday && !selected && (
								<span className="absolute inset-x-2 bottom-0.5 h-px bg-primary" />
							)}
						</button>
					);
				})}
			</div>
			<div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
				<span className="flex items-center gap-1">
					<span className="size-2 rounded-sm bg-muted" /> Weekend / holiday
				</span>
				<span className="flex items-center gap-1">
					<span className="size-2 rounded-sm ring-1 ring-amber-400/60" /> Existing
					request
				</span>
			</div>
		</div>
	);
}
