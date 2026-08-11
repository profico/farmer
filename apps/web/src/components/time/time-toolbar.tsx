import { CalendarDotsIcon } from "@phosphor-icons/react";
import { type ReactNode, useRef } from "react";
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
					{jumpTo ? <DateJump {...jumpTo} /> : (
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
 * A native `<input type="date">` rather than a hand-built calendar popover: this
 * app has no calendar primitive (`components/ui` has none, and the five date
 * fields it already has are all native), the native one is localized, keyboard
 * accessible and screen-reader labelled for free, and on mobile it is the
 * platform picker. The input is laid over the icon at zero opacity so the icon
 * stays the visual affordance; `showPicker()` opens it on click where supported,
 * and where it is not, clicking the input itself still does.
 */
function DateJump({
	value,
	onPick,
}: {
	value: string;
	onPick: (date: string) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);

	return (
		<span className="relative flex items-center">
			<CalendarDotsIcon className="size-3.5 text-muted-foreground" />
			<input
				ref={inputRef}
				type="date"
				aria-label="Jump to date"
				value={value}
				onChange={(e) => {
					if (e.target.value) onPick(e.target.value);
				}}
				onClick={() => inputRef.current?.showPicker?.()}
				className="absolute -inset-1.5 cursor-pointer opacity-0"
			/>
		</span>
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
