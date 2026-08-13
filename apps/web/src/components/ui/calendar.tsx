"use client";

import {
	addDaysToKey,
	endOfMonthKey,
	startOfWeekKey,
} from "@farmer/core/lib/time";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import * as React from "react";
import { formatDateKeyLong, formatMonthKey } from "#/lib/format-date.ts";
import { cn } from "#/lib/utils.ts";

/**
 * A month grid over `yyyy-MM-dd` keys.
 *
 * Deliberately hand-built on the same string keys the rest of the app uses
 * rather than pulled in from react-day-picker. Every date in this product is a
 * calendar key with no time-of-day — `lib/time.ts` exists precisely so that a
 * day never becomes an instant — and a library that works in `Date` objects
 * would put a timezone conversion on both sides of every selection, which is
 * the one bug class those helpers were written to remove. The grid arithmetic
 * that buys is six lines; the conversions would have been everywhere.
 *
 * The week starts Monday, matching `startOfWeekKey` and the week grid.
 */

const WEEKDAY_INITIALS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** Six rows always, so the popover doesn't change height between months. */
const WEEKS = 6;

const monthOf = (key: string) => key.slice(0, 7);

const shiftMonth = (monthKey: string, by: number) => {
	const [year, month] = monthKey.split("-").map(Number);
	// Day 1 of a shifted month, via UTC so the local zone can't slip it.
	const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1 + by, 1));
	return shifted.toISOString().slice(0, 7);
};

export function Calendar({
	value,
	onSelect,
	/** Day keys outside `[min, max]` are shown but not selectable. */
	min,
	max,
	/** Today, as a day key — passed in so the caller decides the timezone. */
	today,
	className,
	/** Set by a popover so it can hand Base UI the cell to focus on open —
	 *  see `initialFocus` at the DatePicker call site. */
	gridRef: externalGridRef,
}: {
	value?: string | null;
	onSelect: (dateKey: string) => void;
	min?: string;
	max?: string;
	today?: string;
	className?: string;
	gridRef?: React.RefObject<HTMLDivElement | null>;
}) {
	// The month on screen. Follows `value` when it moves to another month (a
	// caller stepping the date with ‹ › should not leave the grid behind), but
	// is otherwise the user's own paging state.
	const [month, setMonth] = React.useState(() =>
		monthOf(value || today || new Date().toISOString().slice(0, 10)),
	);
	const [lastValue, setLastValue] = React.useState(value);
	if (value !== lastValue) {
		setLastValue(value);
		if (value) setMonth(monthOf(value));
	}

	// The one cell in the tab order. Arrow keys move it; Tab leaves the grid.
	const [focusedDay, setFocusedDay] = React.useState<string | null>(null);
	const ownGridRef = React.useRef<HTMLDivElement>(null);
	const gridRef = externalGridRef ?? ownGridRef;

	const firstOfMonth = `${month}-01`;
	const gridStart = startOfWeekKey(firstOfMonth);
	const days = Array.from({ length: WEEKS * 7 }, (_, i) =>
		addDaysToKey(gridStart, i),
	);

	const outOfRange = (day: string) =>
		(min != null && day < min) || (max != null && day > max);

	// Where the roving tabstop sits when nothing has been focused yet: the
	// selection, else today, else the first day of the month — never a day that
	// cannot be picked.
	const tabStop =
		focusedDay ??
		(value && monthOf(value) === month && !outOfRange(value)
			? value
			: today && monthOf(today) === month && !outOfRange(today)
				? today
				: (days.find((d) => monthOf(d) === month && !outOfRange(d)) ??
					firstOfMonth));

	// Focus follows the roving tabstop, but only once the user is actually
	// inside the grid — otherwise opening the popover would steal focus on
	// every re-render.
	// biome-ignore lint/correctness/useExhaustiveDependencies: gridRef is a ref, stable for the component's life — biome can't see that through the `externalGridRef ?? ownGridRef` fallback.
	React.useEffect(() => {
		if (!focusedDay) return;
		gridRef.current
			?.querySelector<HTMLButtonElement>(`[data-day="${focusedDay}"]`)
			?.focus();
	}, [focusedDay]);

	const moveTo = (day: string) => {
		if (monthOf(day) !== month) setMonth(monthOf(day));
		setFocusedDay(day);
	};

	const onKeyDown = (event: React.KeyboardEvent, day: string) => {
		const step: Record<string, number> = {
			ArrowLeft: -1,
			ArrowRight: 1,
			ArrowUp: -7,
			ArrowDown: 7,
		};
		if (event.key in step) {
			event.preventDefault();
			moveTo(addDaysToKey(day, step[event.key] as number));
			return;
		}
		if (event.key === "Home") {
			event.preventDefault();
			moveTo(startOfWeekKey(day));
			return;
		}
		if (event.key === "End") {
			event.preventDefault();
			moveTo(addDaysToKey(startOfWeekKey(day), 6));
			return;
		}
		if (event.key === "PageUp" || event.key === "PageDown") {
			event.preventDefault();
			const next = shiftMonth(month, event.key === "PageUp" ? -1 : 1);
			setMonth(next);
			// Keep the day-of-month where possible; a 31st landing in a short
			// month clamps to that month's last day rather than spilling over.
			const wanted = `${next}-${day.slice(-2)}`;
			const end = endOfMonthKey(`${next}-01`);
			setFocusedDay(wanted > end ? end : wanted);
		}
	};

	const canGo = (target: string) => {
		// A month is reachable if any of its days are in range.
		const first = `${target}-01`;
		const last = endOfMonthKey(first);
		return !(max != null && first > max) && !(min != null && last < min);
	};
	const prevMonth = shiftMonth(month, -1);
	const nextMonth = shiftMonth(month, 1);

	return (
		<div className={cn("w-64 p-3", className)}>
			<div className="flex items-center justify-between gap-1 pb-2">
				<button
					type="button"
					aria-label={`Go to ${formatMonthKey(prevMonth)}`}
					disabled={!canGo(prevMonth)}
					onClick={() => setMonth(prevMonth)}
					className={navButtonClass}
				>
					<CaretLeftIcon weight="regular" className="size-3.5" />
				</button>
				{/* aria-live so paging with the buttons is announced; the grid's own
				    cells carry the full date, so this is a heading, not the label. */}
				<div aria-live="polite" className="text-sm font-medium">
					{formatMonthKey(month)}
				</div>
				<button
					type="button"
					aria-label={`Go to ${formatMonthKey(nextMonth)}`}
					disabled={!canGo(nextMonth)}
					onClick={() => setMonth(nextMonth)}
					className={navButtonClass}
				>
					<CaretRightIcon weight="regular" className="size-3.5" />
				</button>
			</div>

			<div className="grid grid-cols-7 gap-0.5 pb-1">
				{WEEKDAY_INITIALS.map((label) => (
					<div
						key={label}
						aria-hidden
						className="flex h-7 items-center justify-center text-xs font-medium text-faint"
					>
						{label}
					</div>
				))}
			</div>

			{/* biome-ignore lint/a11y/useSemanticElements: the layout is CSS grid, not a table; the ARIA grid pattern is what the roving tabstop below implements. */}
			<div
				ref={gridRef}
				role="grid"
				aria-label={formatMonthKey(month)}
				className="grid grid-cols-7 gap-0.5"
			>
				{days.map((day) => {
					const inMonth = monthOf(day) === month;
					const disabled = outOfRange(day);
					const selected = value === day;
					const isToday = today === day;
					return (
						// biome-ignore lint/a11y/useSemanticElements: a <td> is not the widget — the cell is the button that gets focused and pressed, so the role goes on it.
						<button
							key={day}
							type="button"
							role="gridcell"
							data-day={day}
							// One tabstop for the whole grid: Tab moves past the calendar,
							// arrows move within it. Anything else makes a month 42 stops.
							tabIndex={day === tabStop ? 0 : -1}
							disabled={disabled}
							aria-selected={selected}
							aria-current={isToday ? "date" : undefined}
							aria-label={formatDateKeyLong(day)}
							onFocus={() => setFocusedDay(day)}
							onKeyDown={(event) => onKeyDown(event, day)}
							onClick={() => onSelect(day)}
							className={cn(
								"mono flex h-8 items-center justify-center rounded-md text-sm tabular-nums transition-colors duration-(--dur-fast) outline-none",
								"focus-visible:ring-3 focus-visible:ring-ring/40",
								inMonth ? "text-foreground" : "text-faint",
								!disabled && !selected && "hover:bg-muted",
								// Today reads as a ring so it survives being selected;
								// selection is the filled one, and the two can coincide.
								isToday && !selected && "ring-1 ring-border ring-inset",
								selected &&
									"bg-primary text-primary-foreground hover:bg-primary",
								disabled && "cursor-not-allowed opacity-30",
							)}
						>
							{Number(day.slice(-2))}
						</button>
					);
				})}
			</div>
		</div>
	);
}

const navButtonClass =
	"flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-(--dur-fast) outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-30";
