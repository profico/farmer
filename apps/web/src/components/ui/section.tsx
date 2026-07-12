import type { ReactNode } from "react";
import { cn } from "#/lib/utils.ts";

// Shared building block for the "sectioned" page layout used across the
// app: a header strip plus content, framed by edge-to-edge borders instead
// of a floating rounded card. Stack multiple `Section`s directly inside a
// plain wrapper div — the border-t/last:border-b combo produces continuous
// full-width dividers between them, matching the calendar month view.
export function Section({
	title,
	description,
	action,
	children,
	className,
}: {
	title: string;
	description?: string;
	action?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section
			className={cn("border-t px-4 py-5 last:border-b sm:px-8", className)}
		>
			<div className="flex items-center justify-between gap-4">
				<div>
					<h2 className="text-sm font-semibold">{title}</h2>
					{description && (
						<p className="mt-0.5 text-xs text-muted-foreground">
							{description}
						</p>
					)}
				</div>
				{action}
			</div>
			<div className="mt-3">{children}</div>
		</section>
	);
}
