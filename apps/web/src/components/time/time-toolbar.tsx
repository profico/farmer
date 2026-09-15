import { CalendarDotsIcon } from "@phosphor-icons/react";
import { type ReactNode, useRef, useState } from "react";

import { Calendar } from "#/components/ui/calendar.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover.tsx";
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
	jumpTo,
	returnLink,
	children,
}: {
	add?: ReactNode;
	prev: ReactNode;
	label: ReactNode;
	next: ReactNode;
	/** Where a picked date should take this view. Turns the calendar icon in the
	 *  middle of the stepper group into an actual date picker — without it the
	 *  only way to reach a date six weeks back was forty-two clicks on ‹. */
	jumpTo?: { value: string; onPick: (date: string) => void };
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
					{jumpTo ? (
						<DateJump {...jumpTo} />
					) : (
						<CalendarDotsIcon className="size-3.5 text-muted-foreground" />
					)}
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

/**
 * The calendar icon, made to do what it looks like it does.
 *
 * This one is the icon itself rather than the shared DatePicker box: it lives
 * inside the ‹ date › stepper group, where a bordered field would read as a
 * second control sitting on top of the first. Same popover and same calendar as
 * everywhere else — only the trigger differs. The Log time dialog's stepper
 * borrows it, so a day is picked the same way in both places.
 */
export function DateJump({
	value,
	onPick,
}: {
	value: string;
	onPick: (date: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const gridRef = useRef<HTMLDivElement>(null);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<button
						type="button"
						aria-label="Jump to date"
						className="flex items-center rounded-md p-1 text-muted-foreground transition-colors duration-(--dur-fast) outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
					>
						<CalendarDotsIcon className="size-3.5" />
					</button>
				}
			/>
			<PopoverContent
				align="center"
				initialFocus={() =>
					gridRef.current?.querySelector<HTMLButtonElement>(
						'[data-day][tabindex="0"]',
					)
				}
			>
				<Calendar
					gridRef={gridRef}
					value={value}
					today={value}
					onSelect={(next) => {
						onPick(next);
						setOpen(false);
					}}
				/>
			</PopoverContent>
		</Popover>
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
