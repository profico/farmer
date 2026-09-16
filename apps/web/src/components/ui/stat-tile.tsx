import type { ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * The target band: one tile per period, on the band surface, with its rail as a
 * full-bleed underline along the bottom edge.
 *
 * Two earlier shapes failed for the same reason, and it is worth writing down.
 * A 28px figure over a caption was simply too tall for a band that sits above
 * the thing the screen is for. Then an 11px bold caps label beside a 17px
 * figure was too SHORT, and worse: caps with wide tracking read heavier than
 * their point size, so a bold caps label and a 17px figure land at nearly the
 * same optical weight and neither leads. A progress ring made it a third
 * element competing at that weight, carrying what the rail already carried.
 *
 * So: the label is 12px medium in the muted tone and never bold, the figure is
 * 22px semibold — a real step above it — and the rail is the tile's bottom
 * edge rather than an inset bar, which is what lets it carry the verdict colour
 * without becoming a fourth object.
 */
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
				"grid gap-2.5",
				columns === 2 && "sm:grid-cols-2",
				columns === 3 && "sm:grid-cols-3",
				columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
				className,
			)}
		>
			{children}
		</div>
	);
}

/** The tone of a tile's underline. `neutral` is the accent. */
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
	/** 0 to 100, drawn as the tile's bottom edge. `null` draws the track only. */
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
	const shown = percent == null ? null : Math.max(0, Math.min(100, percent));
	return (
		<div
			data-slot="stat-tile"
			className={cn(
				"flex flex-col overflow-hidden rounded-xl bg-secondary px-3.5 pt-3",
				className,
			)}
		>
			<div className="flex min-h-5 items-center justify-between gap-2">
				<span className="text-xs font-medium tracking-[0.07em] text-muted-foreground uppercase">
					{label}
				</span>
				{aside}
			</div>
			<div className="tnum mt-2 text-[22px] leading-none font-semibold tracking-[-0.025em]">
				{value}
			</div>
			{/* One fixed row whether or not there is a caption, so three tiles in a
			    row are the same height and their underlines land on one line. */}
			<div className="mt-1.5 h-[17px] truncate text-xs text-muted-foreground">
				{caption}
			</div>
			<div className="mt-3 -mx-3.5 h-[3px] bg-line2">
				{shown != null && (
					<span
						className={cn("rail-fill block h-full", TONE_FILL[tone])}
						style={{ width: `${shown}%` }}
					/>
				)}
			</div>
		</div>
	);
}

/** The lesser figure trailing a big one: "8,00<Of>/ 40,00</Of>". */
export function Of({ children }: { children: ReactNode }) {
	return (
		<span className="text-[13px] font-normal tracking-[-0.01em] text-muted-foreground">
			{" "}
			{children}
		</span>
	);
}

/**
 * The other shape a figure takes: a band of plain cells divided by soft
 * hairlines, for figures that are not a proportion of anything.
 *
 * The project page's four — all-time hours, this month, active since, overtime
 * — have no target to be a percentage of, so a ring would be a decoration. They
 * get a label, a figure and one caption each, at a size well below the page
 * title. It used to be a 26px figure with "January 2, 2024" set at the same
 * weight as 33.644,25, which put a date and a measurement in the same voice.
 */
export function FigureBand({
	children,
	className,
	columns = 4,
}: {
	children: ReactNode;
	className?: string;
	columns?: 2 | 3 | 4;
}) {
	return (
		<div
			data-slot="figure-band"
			className={cn(
				"grid border-y border-line",
				columns === 2 && "sm:grid-cols-2",
				columns === 3 && "sm:grid-cols-3",
				columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
				className,
			)}
		>
			{children}
		</div>
	);
}

export function FigureCell({
	label,
	value,
	caption,
	children,
	className,
}: {
	label: ReactNode;
	value: ReactNode;
	caption?: ReactNode;
	children?: ReactNode;
	className?: string;
}) {
	return (
		<div
			data-slot="figure-cell"
			className={cn(
				"py-3.5 sm:px-5 sm:not-first:border-l sm:not-first:border-line2 sm:first:pl-0",
				className,
			)}
		>
			<div className="eyebrow">{label}</div>
			<div className="tnum mt-2 text-xl leading-none font-semibold tracking-[-0.03em]">
				{value}
			</div>
			{caption && (
				<div className="mt-2 text-sm text-muted-foreground">{caption}</div>
			)}
			{children}
		</div>
	);
}
