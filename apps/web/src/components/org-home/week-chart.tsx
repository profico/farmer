import { formatReportHours } from "@farmer/core/lib/report-format";

import {
	dayFigure,
	type DayVerdict,
	dayVerdict,
	PLOT_H,
	type WeekDay,
} from "#/lib/org-home.ts";
import { cn } from "#/lib/utils.ts";

const BAR_CLASS = {
	none: "bg-line",
	covered: "bg-line-strong",
	bad: "bg-bad",
	ok: "bg-ok",
	warn: "bg-warn",
} satisfies Record<DayVerdict, string>;

const FIGURE_CLASS = {
	none: "text-faint",
	covered: "text-muted-foreground",
	bad: "text-bad",
	ok: "text-ok",
	warn: "text-warn",
} satisfies Record<DayVerdict, string>;

/** One weekday of the week chart. The whole column is the button. */
function WeekDayColumn({
	d,
	i,
	selected,
	maxDaySeconds,
	onSelect,
}: {
	d: WeekDay;
	i: number;
	selected: boolean;
	maxDaySeconds: number;
	onSelect: (key: string) => void;
}) {
	const px =
		d.seconds > 0
			? Math.max(Math.round((d.seconds / maxDaySeconds) * PLOT_H), 3)
			: 2;
	const verdict = dayVerdict(d);
	return (
		<button
			type="button"
			onClick={() => onSelect(d.key)}
			aria-pressed={selected}
			aria-label={`${d.label}, ${formatReportHours(d.seconds)}`}
			// `min-w-0` because a grid item will not shrink below its
			// content by default, and the content here is a three-letter
			// label with tracking on it. Without it a narrow chart did
			// not compress — it overflowed, and seven weekday labels
			// were drawn across each other. The spans truncate for the
			// same reason: past a point the honest answer is "WE…".
			className={cn(
				"flex min-w-0 flex-col rounded-sm pb-1.5 transition-colors duration-(--dur-fast) outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40",
				d.isWeekend && !selected && "opacity-45",
			)}
		>
			<span
				className="flex w-full items-end justify-center"
				style={{ height: `${PLOT_H}px` }}
			>
				<span
					className={cn(
						"rise block w-5 rounded-t-[2px]",
						d.holiday ? "bg-warn/40" : BAR_CLASS[verdict],
					)}
					style={{
						height: `${px}px`,
						animationDelay: `${i * 40}ms`,
					}}
				/>
			</span>
			<span
				className={cn(
					"eyebrow mt-2.5 w-full truncate",
					d.isToday && "text-foreground",
					selected && "text-primary",
				)}
			>
				{d.label}
			</span>
			<span
				className={cn(
					"mono mt-1.5 w-full truncate text-2xs",
					FIGURE_CLASS[verdict],
				)}
			>
				{dayFigure(d)}
			</span>
		</button>
	);
}

/** The seven bars, the baseline and the target rule over them. */
export function WeekChart({
	perDay,
	selectedDay,
	maxDaySeconds,
	targetPx,
	onSelect,
}: {
	perDay: WeekDay[];
	selectedDay: string;
	maxDaySeconds: number;
	targetPx: number;
	onSelect: (key: string) => void;
}) {
	return (
		<div className="relative mt-4">
			<span
				aria-hidden
				className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-foreground/25"
				style={{ top: `${PLOT_H - targetPx}px` }}
			/>
			<span
				aria-hidden
				className="pointer-events-none absolute inset-x-0 z-10 border-t border-line"
				style={{ top: `${PLOT_H}px` }}
			/>
			<div className="grid grid-cols-7">
				{perDay.map((d, i) => (
					<WeekDayColumn
						key={d.key}
						d={d}
						i={i}
						selected={d.key === selectedDay}
						maxDaySeconds={maxDaySeconds}
						onSelect={onSelect}
					/>
				))}
			</div>
		</div>
	);
}
