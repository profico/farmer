import type { ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * The target band: one cell per period, side by side between two hairlines,
 * each with a thin meter under its caption.
 *
 * It used to be a row of filled tiles, and before that a ring in a card. The
 * page is the only island, and nothing inside it is a card any more: a band of
 * plain cells is the same shape the project page's figures already take
 * (`FigureBand`), so the two read as one idiom.
 *
 * The figure is the display face (Hedvig Letters Serif, or Inclusive Sans under
 * "Boring font") at 26px, a real step above the 12px label; the meter carries
 * the verdict colour so the figure never has to.
 */
export function StatTiles({
	children,
	className,
	columns = 3,
}: {
	children: ReactNode;
	className?: string;
	columns?: 2 | 3;
}) {
	return (
		<div
			data-slot="stat-tiles"
			className={cn(
				"grid border-y border-line",
				columns === 2 && "sm:grid-cols-2",
				columns === 3 && "sm:grid-cols-3",
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
	/** 0 to 100, drawn as the meter. `null` draws the track only. */
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
				// Stacked on a phone, the cells are divided by the soft hairline on
				// top; side by side, by the same hairline on the left, and the outer
				// cells lose their outer padding so the band's text lines up with
				// the page's.
				"flex min-w-0 flex-col py-3.5 not-first:border-t not-first:border-line2 sm:px-5 sm:not-first:border-t-0 sm:not-first:border-l sm:first:pl-0 sm:last:pr-0",
				className,
			)}
		>
			<div className="flex min-h-5 items-center justify-between gap-2">
				<span className="text-xs font-medium tracking-[0.07em] text-muted-foreground uppercase">
					{label}
				</span>
				{aside}
			</div>
			<div className="font-display mt-2.5 text-[26px] leading-none">
				{value}
			</div>
			{/* One fixed row whether or not there is a caption, so the cells in a
			    row are the same height and their meters land on one line. */}
			<div className="mt-1.5 h-[17px] truncate text-xs text-muted-foreground">
				{caption}
			</div>
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
		</div>
	);
}

/** The lesser figure trailing a big one: "8,00<Of>/ 40,00</Of>". Always the
 *  body face, so the display face is kept for the figure that matters. */
export function Of({ children }: { children: ReactNode }) {
	return (
		<span className="font-sans text-[13px] font-normal tracking-normal text-muted-foreground">
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
			<div className="font-display mt-2 text-[22px] leading-none">{value}</div>
			{caption && (
				<div className="mt-2 text-sm text-muted-foreground">{caption}</div>
			)}
			{children}
		</div>
	);
}
