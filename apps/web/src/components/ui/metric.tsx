import type { ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * A large number over a small uppercase caption — the design's main way of
 * showing a figure.
 *
 * Set in the display face at 600 with tabular numerals, the way Framer sets a
 * figure: the same family as the title above it, a step heavier, and digits
 * that line up. Mono stays for what is an id rather than a measure — a sha, a
 * project code — and for the columns of a table, where forty rows of figures
 * are compared down the page.
 */
export function Metric({
	value,
	label,
	size = 30,
	accent = false,
	className,
}: {
	value: ReactNode;
	label: ReactNode;
	/** px. The figure is the one thing on the page sized to its own importance. */
	size?: number;
	accent?: boolean;
	className?: string;
}) {
	return (
		<div className={className}>
			<div
				className={cn(
					"font-display tnum font-semibold",
					accent && "text-primary",
				)}
				style={{ fontSize: size, lineHeight: 1, letterSpacing: "-0.03em" }}
			>
				{value}
			</div>
			{/* 1.35 rather than 1: a label that qualifies itself — "This week vs.
			    your target" — reaches two lines in a narrow column, and at a
			    line-height of 1 the two sit on top of each other. */}
			<div className="eyebrow mt-2.5 leading-[1.35] text-muted-foreground text-balance">
				{label}
			</div>
		</div>
	);
}

/** The smaller unit trailing a figure: "7<Unit>h</Unit> 12<Unit>m</Unit>". */
export function Unit({ children }: { children: ReactNode }) {
	return <span className="text-[0.66em]">{children}</span>;
}
