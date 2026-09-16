import type { ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * A row of small figure chips: a progress ring, a label and a figure, in a
 * card the width of what it holds.
 *
 * It used to be a full-bleed band of three tall tiles with a 28px figure, a
 * sentence and a rail each, which took a third of the home page's height and
 * out-weighed the entry list underneath — the thing the screen is actually
 * for. This is about half as tall and much narrower, so the row it sits in has
 * room for the sentence that used to need its own line.
 *
 * The ring carries the proportion, which is what the rail used to do in four
 * times the width. It is a conic gradient rather than an SVG: one element, no
 * viewBox arithmetic, and it animates by interpolating a single percentage.
 */
export function StatTiles({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			data-slot="stat-tiles"
			className={cn("flex flex-wrap items-center gap-2", className)}
		>
			{children}
		</div>
	);
}

/** The tone of a tile's ring and its percentage. `neutral` is the accent. */
type Tone = "neutral" | "ok" | "warn" | "bad";

const TONE_VAR = {
	neutral: "var(--acc)",
	ok: "var(--ok)",
	warn: "var(--warn)",
	bad: "var(--bad)",
} as const satisfies Record<Tone, string>;

const TONE_TEXT = {
	neutral: "text-primary",
	ok: "text-ok",
	warn: "text-warn",
	bad: "text-bad",
} as const satisfies Record<Tone, string>;

export function StatTile({
	label,
	value,
	/** 0 to 100. Drives the ring and the figure inside it. */
	percent,
	tone = "neutral",
	className,
}: {
	label: ReactNode;
	value: ReactNode;
	percent: number | null;
	tone?: Tone;
	className?: string;
}) {
	const shown = percent == null ? null : Math.max(0, Math.min(100, percent));
	return (
		<div
			data-slot="stat-tile"
			className={cn(
				"flex items-center gap-3 rounded-xl bg-secondary py-2.5 pr-3.5 pl-2.5",
				className,
			)}
		>
			{shown != null && (
				<span
					aria-hidden
					className="grid size-8 shrink-0 place-items-center rounded-full"
					style={{
						background: `conic-gradient(${TONE_VAR[tone]} ${shown}%, var(--line) 0)`,
					}}
				>
					<span
						className={cn(
							"tnum grid size-6 place-items-center rounded-full bg-secondary text-[9px] font-semibold",
							TONE_TEXT[tone],
						)}
					>
						{Math.round(shown)}%
					</span>
				</span>
			)}
			<span className="min-w-0">
				<span className="eyebrow block">{label}</span>
				<span className="tnum mt-1 block text-md leading-none font-semibold tracking-[-0.02em]">
					{value}
				</span>
			</span>
		</div>
	);
}

/** The lesser figure trailing a big one: "8,00<Of>/ 40,00</Of>". */
export function Of({ children }: { children: ReactNode }) {
	return (
		<span className="ml-1 text-xs font-normal tracking-[-0.01em] text-muted-foreground">
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
