import { addDaysToKey, formatDayKey } from "@farmer/core/lib/time";
import { CalendarBlankIcon, CaretDownIcon } from "@phosphor-icons/react";
import { type ReactNode, useRef, useState } from "react";

import { Calendar } from "#/components/ui/calendar.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * The one control for "which day" and "which period", everywhere.
 *
 * A period used to be three controls that did not know about each other: a
 * `Month` select, a ‹ date › stepper and a "Return to this month" link — and
 * the Log time dialog carried a fourth, unrelated stepper of its own. Five
 * screens, four different answers to one question.
 *
 * This is one trigger that reads the resolved period, opening a rail of presets
 * beside a calendar. Picking a preset closes it; picking a day on the calendar
 * answers the same question directly.
 *
 * It has two modes, and they are the same component because they are the same
 * question asked at two grains. `day` is the timesheet and the Log time dialog:
 * one date, presets are Today / Yesterday / and so on. `period` is the reports,
 * the project page and the hour fund: a named span, presets are This month /
 * Last month / This quarter.
 */

export type PeriodPreset = {
	id: string;
	label: string;
	/** A rule above the row, for the break between "near" and "named" presets. */
	separated?: boolean;
};

export function PeriodPicker({
	label,
	sub,
	presets,
	activePresetId,
	onPreset,
	calendarValue,
	onPickDay,
	range,
	onPickRange,
	disabled,
	align = "start",
	className,
	triggerClassName,
}: {
	/** What the trigger reads: "September 2026", "Tuesday, 15 September". */
	label: ReactNode;
	/** The quieter half of the trigger: a range, or "Today". */
	sub?: ReactNode;
	presets: PeriodPreset[];
	activePresetId?: string | null;
	onPreset: (id: string) => void;
	/** The day the calendar opens on and marks. */
	calendarValue: string;
	/** A day picked on the calendar. Omit to show presets only. */
	onPickDay?: (date: string) => void;
	/** The resolved span, painted under the days. Without it, a Week or a Month
	 *  selection showed as ONE filled circle in the middle of a month, which
	 *  says the reader picked the 14th when they picked the week it starts. */
	range?: { from: string; to: string } | null;
	/** Turns the calendar into a two-click range picker: the first click sets
	 *  the start, the second the end, and the span between them previews as you
	 *  move. Used by Custom, where the range IS the answer. */
	onPickRange?: (range: { from: string; to: string }) => void;
	disabled?: boolean;
	align?: "start" | "center" | "end";
	className?: string;
	triggerClassName?: string;
}) {
	const [open, setOpen] = useState(false);
	const gridRef = useRef<HTMLDivElement>(null);
	// The half-made range, while a two-click pick is in flight. Cleared when the
	// popover closes so a range abandoned half-way never survives to the next
	// opening as a start with no end.
	const [pendingFrom, setPendingFrom] = useState<string | null>(null);
	const shownRange = pendingFrom
		? { from: pendingFrom, to: pendingFrom }
		: (range ?? null);

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setPendingFrom(null);
			}}
		>
			<PopoverTrigger
				render={
					<button
						type="button"
						disabled={disabled}
						aria-label="Change period"
						className={cn(
							"inline-flex h-8 items-center gap-2 rounded-lg border border-line2 bg-secondary px-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-(--dur-fast) outline-none hover:border-line-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/16 disabled:pointer-events-none disabled:opacity-50",
							triggerClassName,
						)}
					>
						<CalendarBlankIcon
							weight="regular"
							className="size-3.5 shrink-0 text-muted-foreground"
						/>
						{label}
						{sub && (
							<span className="font-normal text-muted-foreground">{sub}</span>
						)}
						<CaretDownIcon
							weight="bold"
							className="size-3 shrink-0 text-muted-foreground"
						/>
					</button>
				}
			/>
			<PopoverContent
				align={align}
				className={cn("flex w-auto p-0", className)}
				initialFocus={() =>
					gridRef.current?.querySelector<HTMLButtonElement>(
						'[data-day][tabindex="0"]',
					)
				}
			>
				{/* The rail. A preset is the answer for nine visits out of ten, so it
				    sits where the pointer already is rather than behind the calendar. */}
				<div className="flex min-w-[9.5rem] flex-col gap-px border-r border-line2 p-2">
					{presets.map((preset) => (
						<div key={preset.id}>
							{preset.separated && <div className="my-1.5 h-px bg-line2" />}
							<button
								type="button"
								onClick={() => {
									onPreset(preset.id);
									setOpen(false);
								}}
								className={cn(
									"w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors duration-(--dur-fast) outline-none focus-visible:ring-3 focus-visible:ring-ring/16",
									preset.id === activePresetId
										? "bg-secondary font-semibold text-foreground"
										: "text-muted-foreground hover:bg-muted hover:text-foreground",
								)}
							>
								{preset.label}
							</button>
						</div>
					))}
				</div>
				{(onPickDay || onPickRange) && (
					<div className="p-3">
						{onPickRange && (
							<p className="mb-2 px-1 text-xs text-muted-foreground">
								{pendingFrom
									? "Now pick the last day"
									: "Pick the first day of the range"}
							</p>
						)}
						<Calendar
							gridRef={gridRef}
							value={onPickRange ? null : calendarValue}
							range={shownRange}
							today={calendarValue}
							onSelect={(next) => {
								if (onPickRange) {
									if (!pendingFrom) {
										setPendingFrom(next);
										return;
									}
									// Either way round: clicking an earlier day second means
									// the reader is drawing the range backwards, not making a
									// mistake.
									onPickRange(
										next < pendingFrom
											? { from: next, to: pendingFrom }
											: { from: pendingFrom, to: next },
									);
									setPendingFrom(null);
									setOpen(false);
									return;
								}
								onPickDay?.(next);
								setOpen(false);
							}}
						/>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

/** The presets a single-DAY picker offers, resolved against the day in hand. */
export const dayPresets = (today: string): PeriodPreset[] => [
	{ id: today, label: "Today" },
	{ id: addDaysToKey(today, -1), label: "Yesterday" },
	{ id: addDaysToKey(today, -7), label: "A week ago", separated: true },
];

/** How a single date reads in a day picker's trigger. */
export const dayTriggerLabel = (date: string, today: string) => ({
	label: formatDayKey(date, { year: false }),
	sub:
		date === today
			? "Today"
			: date === addDaysToKey(today, -1)
				? "Yesterday"
				: undefined,
});
