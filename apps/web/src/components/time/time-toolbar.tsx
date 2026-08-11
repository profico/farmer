import { CalendarDotsIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cn } from "#/lib/utils.ts";

// The toolbar every timesheet view shares, laid out the way Harvest lays it out:
// the add button first, then the date stepper, then a "return to now" link, with
// each view's own controls pushed to the right. Keeping the geometry identical
// across Day/Week/Month is the point — the eye should not have to re-find the
// arrows when the tab changes.
export function TimeToolbar({
	add,
	prev,
	label,
	next,
	returnLink,
	children,
}: {
	add?: ReactNode;
	prev: ReactNode;
	label: ReactNode;
	next: ReactNode;
	/** Rendered only when the view is off today/this week/this month. */
	returnLink?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div className="flex shrink-0 flex-wrap items-center gap-3">
			{add}
			<div className="flex h-8 items-center rounded-lg border">
				{prev}
				<span className="flex items-center gap-1.5 border-x px-3 text-sm font-medium whitespace-nowrap">
					<CalendarDotsIcon className="size-3.5 text-muted-foreground" />
					{label}
				</span>
				{next}
			</div>
			{returnLink}
			{children && (
				<div className="ml-auto flex items-center gap-2">{children}</div>
			)}
		</div>
	);
}

/** Shared classes for the ‹ / › steppers, so they sit flush inside the group. */
export const stepperClass =
	"flex h-full w-8 items-center justify-center text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground";

/** Harvest renders "Return to today" as a plain underlined link, not a button —
 *  it's an escape hatch, not a peer of the steppers. */
export const returnLinkClass = "underlined text-sm";

export function ToolbarLabel({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <span className={cn("whitespace-nowrap", className)}>{children}</span>;
}
