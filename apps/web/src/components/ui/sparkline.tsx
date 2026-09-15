import { cn } from "#/lib/utils.ts";

/**
 * A row of bars under a figure — the last twelve months of a project, the
 * last seven days of a person. Bars are the band surface; the last one, the
 * period the figure describes, is the accent. Heights are relative to the
 * biggest value in the set, and a set of zeros draws a row of hairline stubs
 * rather than nothing, so an empty history still has a shape.
 *
 * Each bar rises from the baseline on arrival (`.rise`, styles.css), in
 * order, which is what makes twelve bars read as a history rather than a
 * barcode.
 */
export function Sparkline({
	values,
	className,
	height = 22,
	labels,
}: {
	values: number[];
	className?: string;
	/** px */
	height?: number;
	/** One per bar, for the tooltip a reader hovers for. */
	labels?: string[];
}) {
	const max = Math.max(1, ...values);
	return (
		<div
			data-slot="sparkline"
			className={cn("flex items-end gap-0.5", className)}
			style={{ height }}
			aria-hidden
		>
			{values.map((v, i) => (
				<span
					key={i}
					title={labels?.[i]}
					className={cn(
						"rise block flex-1 rounded-t-[2px]",
						i === values.length - 1 ? "bg-primary" : "bg-secondary",
					)}
					style={{
						height: `${Math.max(6, (v / max) * 100)}%`,
						animationDelay: `${i * 30}ms`,
					}}
				/>
			))}
		</div>
	);
}
