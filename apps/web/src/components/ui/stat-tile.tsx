import type { ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * A band of figures, divided by soft hairlines and never boxed (DESIGN.md,
 * "Figure tiles"). The home page's three targets, the project page's four
 * numbers and the Tracking header are all this.
 *
 * The band carries the rules above and below itself; the tiles inside carry
 * only their left divider. Columns come from the caller, because the right
 * count is a property of the screen: three targets, four project figures.
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

/**
 * One figure: an eyebrow (with room for a pill beside it), the number in the
 * display face at 600 with tabular digits, a one-line caption, and whatever
 * the tile needs under that (a rail, a sparkline).
 *
 * The first tile in a band has no left padding and no divider, so the figures
 * line up with the page's own left edge; every other tile is indented past
 * its divider.
 */
export function StatTile({
	label,
	aside,
	value,
	caption,
	children,
	className,
}: {
	label: ReactNode;
	/** Sits at the far right of the eyebrow row: a status pill, a small link. */
	aside?: ReactNode;
	value: ReactNode;
	caption?: ReactNode;
	children?: ReactNode;
	className?: string;
}) {
	return (
		<div
			data-slot="stat-tile"
			className={cn(
				"py-4 sm:px-5 sm:not-first:border-l sm:not-first:border-line2 sm:first:pl-0",
				className,
			)}
		>
			<div className="flex min-h-5 items-center justify-between gap-3">
				<div className="eyebrow">{label}</div>
				{aside}
			</div>
			<div className="font-display tnum mt-2 text-[28px] leading-none font-semibold tracking-[-0.03em]">
				{value}
			</div>
			{caption && (
				<div className="mt-2 text-sm text-muted-foreground">{caption}</div>
			)}
			{children}
		</div>
	);
}

/** The lesser figure trailing a big one: "8,00<Of>/ 40,00</Of>". */
export function Of({ children }: { children: ReactNode }) {
	return (
		<span className="ml-1 text-sm font-normal tracking-[-0.01em] text-muted-foreground">
			{children}
		</span>
	);
}
