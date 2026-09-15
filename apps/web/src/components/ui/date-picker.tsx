"use client";

import { CalendarBlankIcon, XIcon } from "@phosphor-icons/react";
import * as React from "react";

import { Calendar } from "#/components/ui/calendar.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover.tsx";
import { formatDateKeyLong } from "#/lib/format-date.ts";
import { cn } from "#/lib/utils.ts";

/**
 * The one date input in the app.
 *
 * It replaces `<input type="date">`, which was never really ours: the picker it
 * opens is the browser's, so it ignored the app's type, spacing and dark mode,
 * rendered differently in every browser, and put a Chrome-only clear affordance
 * next to fields that must never be empty. This is a button that says the date
 * in the app's own long form and opens the app's own calendar.
 *
 * The value is a `yyyy-MM-dd` key, the same string the old input produced, so
 * call sites only swap the element.
 */
export function DatePicker({
	value,
	onValueChange,
	today,
	min,
	max,
	placeholder = "Pick a date",
	disabled,
	clearable = false,
	className,
	"aria-label": ariaLabel,
	id,
}: {
	value: string | null;
	onValueChange: (value: string | null) => void;
	/** Today's key in the org's timezone, if the caller knows it. */
	today?: string;
	min?: string;
	max?: string;
	placeholder?: string;
	disabled?: boolean;
	/** Adds an inline clear button. Only for fields that may legitimately be
	 *  empty — most of ours may not. */
	clearable?: boolean;
	className?: string;
	"aria-label"?: string;
	id?: string;
}) {
	const [open, setOpen] = React.useState(false);
	const showClear = clearable && value != null && value !== "" && !disabled;
	// Base UI focuses the popup itself by default, which leaves the calendar's
	// roving tabstop unfocused and the arrow keys dead. Hand it the cell.
	const gridRef = React.useRef<HTMLDivElement>(null);
	const focusSelectedDay = () =>
		gridRef.current?.querySelector<HTMLButtonElement>(
			'[data-day][tabindex="0"]',
		);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<button
						type="button"
						id={id}
						disabled={disabled}
						aria-label={ariaLabel}
						// Matches Input's box exactly — same height, radius, border and
						// focus treatment — so a date sits in a row of fields without
						// looking like a different kind of control.
						className={cn(
							"flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-secondary px-2.5 py-1 text-left text-base transition-[border-color,box-shadow] duration-(--dur-base) outline-none hover:not-disabled:not-focus-visible:border-line-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/16 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground data-popup-open:border-ring data-popup-open:ring-3 data-popup-open:ring-ring/16",
							className,
						)}
					>
						<CalendarBlankIcon className="size-4 shrink-0 text-muted-foreground" />
						<span
							className={cn("truncate", !value && "text-faint")}
							// The button's own text is the value; the calendar inside
							// announces the rest.
						>
							{value ? formatDateKeyLong(value) : placeholder}
						</span>
						{showClear && (
							<span
								// oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- this sits inside the trigger <button>, and a button inside a button is invalid HTML — hence a span carrying the role, with the key handling written out below.
								role="button"
								tabIndex={0}
								aria-label="Clear date"
								className="-mr-1 ml-auto flex size-5 shrink-0 items-center justify-center rounded text-faint transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground"
								onClick={(event) => {
									// Don't open the popover on the way out.
									event.stopPropagation();
									onValueChange(null);
								}}
								onKeyDown={(event) => {
									if (event.key !== "Enter" && event.key !== " ") return;
									event.preventDefault();
									event.stopPropagation();
									onValueChange(null);
								}}
							>
								<XIcon weight="regular" className="size-3" />
							</span>
						)}
					</button>
				}
			/>
			<PopoverContent align="start" initialFocus={focusSelectedDay}>
				<Calendar
					gridRef={gridRef}
					value={value}
					today={today}
					min={min}
					max={max}
					onSelect={(next) => {
						onValueChange(next);
						setOpen(false);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}
