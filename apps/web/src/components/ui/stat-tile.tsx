import type { ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * The target band: one cell per period, side by side between two hairlines,
 * each with a thin meter under its caption.
 *
 * The home page and the timesheet both show "this week" and "this month"
 * against the fund. They used to say it two different ways — the home page in
 * a stack of `TargetBlock`s inside a 26rem column, the timesheet in a one-line
 * strip in type sizes that existed nowhere else — so the same two numbers were
 * set differently on two screens a tab apart. One component, one look.
 *
 * **Its borders are `PageSection`'s borders.** The band bleeds to the island's
 * edge and pads its content back, exactly as every hairline-separated band on
 * every other screen does; `--line` closes the band and `--line2` divides the
 * cells inside it, which is the app's one rule for which hairline does which
 * job. Nothing here invents a border of its own.
 *
 * **The cells are divided by a 1px GAP over the band's own background**, not by
 * `divide-x`/`divide-y`. `divide-*` puts a border on every child but the first,
 * which is one rule per DOM position and therefore only correct while the grid
 * is a single row or a single column; a four-cell band wraps to 2x2 on a
 * tablet, where it drew a stray vertical rule down the left edge of the second
 * row and no rule between the rows at all. A gap is drawn by the GRID, so it
 * follows whatever arrangement each breakpoint asks for.
 */

/** Per-column-count metrics, handed to the cells as custom properties: a denser
 *  band pads less and sets its figures smaller. Two and three are the numbers
 *  the band has always used, so those screens are unchanged. */
const COLUMNS = {
	2: "sm:grid-cols-2 [--stat-tile-px:2rem] [--stat-value-size:26px]",
	3: "sm:grid-cols-3 [--stat-tile-px:2rem] [--stat-value-size:26px]",
	4: "sm:grid-cols-2 lg:grid-cols-4 [--stat-tile-px:1.5rem] [--stat-value-size:22px]",
} as const satisfies Record<2 | 3 | 4, string>;

export function StatTiles({
	children,
	className,
	columns = 3,
}: {
	children: ReactNode;
	className?: string;
	columns?: 2 | 3 | 4;
}) {
	return (
		<div
			data-slot="stat-tiles"
			className={cn(
				"-mx-4 grid gap-px border-y border-line bg-line2 sm:-mx-8",
				COLUMNS[columns],
				className,
			)}
		>
			{children}
		</div>
	);
}

/** The tone of a cell's meter. `neutral` is the accent. */
type Tone = "neutral" | "ok" | "warn" | "bad";

const TONE_FILL = {
	neutral: "bg-primary",
	ok: "bg-ok",
	warn: "bg-warn",
	bad: "bg-bad",
} as const satisfies Record<Tone, string>;

export function StatTile({
	label,
	aside,
	value,
	caption,
	/** 0 to 100, drawn as the meter. `null` draws the track only; omitted draws
	 *  no meter, for a figure that is not a fraction of anything. */
	percent,
	tone = "neutral",
	className,
}: {
	label: ReactNode;
	/** The far right of the label row: a status pill. */
	aside?: ReactNode;
	value: ReactNode;
	caption?: ReactNode;
	percent?: number | null;
	tone?: Tone;
	className?: string;
}) {
	// Three answers, not two: a figure with a target draws a fill, a figure whose
	// target is missing draws the empty track (so the cells in one row stay the
	// same height), and a figure that is a fraction of nothing — a date, a count,
	// a project's all-time hours — draws no meter at all.
	const shown = percent == null ? null : Math.max(0, Math.min(100, percent));
	return (
		<div
			data-slot="stat-tile"
			className={cn(
				"flex min-w-0 flex-col bg-background px-4 py-4 sm:px-(--stat-tile-px)",
				className,
			)}
		>
			{/* Held open whether or not there is a pill, so the figures in a row
			    sit on one baseline. */}
			<div className="flex min-h-5 items-center justify-between gap-2">
				<span className="eyebrow">{label}</span>
				{aside}
			</div>
			{/* Mono, like every other figure in the app: the serif names things and
			    the mono measures them (see `Metric`). */}
			<div
				className="mono mt-2.5"
				style={{
					fontSize: "var(--stat-value-size, 26px)",
					lineHeight: 1,
					letterSpacing: "-0.04em",
				}}
			>
				{value}
			</div>
			{/* One fixed row whether or not there is a caption, so the cells in a
			    row are the same height and their meters land on one line. */}
			<div className="mt-2 h-[17px] truncate text-xs text-muted-foreground">
				{caption}
			</div>
			{percent !== undefined && (
				<div className="mt-3 h-[3px] overflow-hidden rounded-full bg-line2">
					{shown != null && (
						<span
							className={cn(
								"rail-fill block h-full rounded-full",
								TONE_FILL[tone],
							)}
							style={{ width: `${shown}%` }}
						/>
					)}
				</div>
			)}
		</div>
	);
}

/** The lesser figure trailing a big one: "8,00<Of>/ 40,00</Of>". Always the
 *  body face, so the mono is kept for the figure that matters. */
export function Of({ children }: { children: ReactNode }) {
	return (
		<span className="font-sans text-[13px] font-normal tracking-normal text-muted-foreground">
			{" "}
			{children}
		</span>
	);
}
