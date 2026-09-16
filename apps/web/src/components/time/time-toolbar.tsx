import { CalendarDotsIcon } from "@phosphor-icons/react";
import { type ReactNode, useRef, useState } from "react";

import { Calendar } from "#/components/ui/calendar.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover.tsx";
import { cn } from "#/lib/utils.ts";

// The one toolbar every timesheet view shares: where you are on the left, what
// you can do on the right, one row, and the primary action last (DESIGN.md,
// "One toolbar"). Keeping the geometry identical across Day/Week/Month is the
// point — the eye should not have to re-find the arrows when the tab changes.
//
// The add button used to sit FIRST, as a bare square icon: the primary action
// of the screen, unlabelled, at the far left, in a row that then ran date,
// link, and two labelled secondary buttons. It is now the last control on the
// right, labelled, which is where every other screen in the app puts its
// primary.
export function TimeToolbar({
	add,
	prev,
	label,
	next,
	picker,
	jumpTo,
	returnLink,
	children,
}: {
	add?: ReactNode;
	prev: ReactNode;
	label: ReactNode;
	next: ReactNode;
	/** The period picker, sitting between the two steppers. When given, it
	 *  replaces `label` and `jumpTo` entirely: it carries the date, the presets
	 *  and the calendar itself. */
	picker?: ReactNode;
	/** Where a picked date should take this view. The older, narrower form of
	 *  the same idea: a calendar icon inside the stepper group. Kept for the
	 *  screens that have not moved to `picker` yet. */
	jumpTo?: { value: string; onPick: (date: string) => void };
	/** Rendered only when the view is off today/this week/this month. */
	returnLink?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
			{/* Cut from the band surface like every other control (DESIGN.md,
			    `text-input`). Outlined, it was the only bordered thing on a screen
			    whose fields are all filled. */}
			{/* The stepper flanks the period picker rather than containing a date
			    of its own: ‹ and › step, the middle opens the presets and the
			    calendar (`ui/period-picker.tsx`). One control answers "which
			    period", on every screen that asks. */}
			<div className="flex h-8 items-center overflow-hidden rounded-lg bg-secondary">
				{prev}
				{picker ?? (
					<span className="flex items-center gap-1.5 border-x border-line2 px-3 text-sm font-medium whitespace-nowrap">
						{jumpTo ? (
							<DateJump {...jumpTo} />
						) : (
							<CalendarDotsIcon className="size-3.5 text-muted-foreground" />
						)}
						{label}
					</span>
				)}
				{next}
			</div>
			{returnLink}
			<div className="ml-auto flex items-center gap-2">
				{children}
				{add}
			</div>
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
	"flex h-full w-8 items-center justify-center text-muted-foreground transition-colors duration-(--dur-fast) outline-none hover:bg-hover-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/16 focus-visible:ring-inset";

/** "Return to today" is an escape hatch, not a peer of the steppers — a quiet
 *  word beside them that only appears when you are somewhere else. */
export const returnLinkClass =
	"rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors duration-(--dur-fast) outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/16";

export function ToolbarLabel({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <span className={cn("whitespace-nowrap", className)}>{children}</span>;
}
