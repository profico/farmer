import { dayKeyInTz, timeKeyInTz } from "@farmer/core/lib/time";
import type { ReactNode } from "react";

import { GoogleCalendarMark } from "#/components/google-calendar-mark.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { formatDateKeyShort } from "#/lib/format-date.ts";
import { formatClock } from "#/lib/format-hours.ts";
import { cn } from "#/lib/utils.ts";

import {
	calendarMarkTitle,
	durationKeyAction,
	hasCount,
	linkedCountTitle,
} from "./entry-block-row-helpers.ts";
import type {
	calendarDifference,
	EntryBlockRowEntry,
} from "./entry-block-row.tsx";

// Sub-components of `EntryBlockRow`. They take props only: every hook, and
// every mutation, stays in the row.

const PILL_CLASS =
	"flex h-5 shrink-0 cursor-pointer items-center rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-popup-open:text-foreground";

type CalendarDiff = NonNullable<ReturnType<typeof calendarDifference>>;

/** The pill's text: the calendar's day, its length, or both. */
function calendarLabel(diff: CalendarDiff) {
	const parts: string[] = [];
	if (diff.date) parts.push(formatDateKeyShort(diff.date));
	if (diff.durationSeconds != null)
		parts.push(formatClock(diff.durationSeconds));
	return parts.join(" · ");
}

/** Where this entry came from. Google's own mark, so a synced meeting is told
 *  from a typed one at a glance; the hover names the meeting's start, which
 *  the duration-only row cannot. */
export function CalendarOriginMark({
	entry,
	timezone,
}: {
	entry: EntryBlockRowEntry;
	timezone: string;
}) {
	const startsAt = entry.meetingStartsAt
		? timeKeyInTz(new Date(entry.meetingStartsAt), timezone)
		: null;
	return (
		<span
			className="flex shrink-0 items-center"
			title={calendarMarkTitle(formatDateKeyShort(entry.date), startsAt)}
		>
			<GoogleCalendarMark className="size-3.5" />
		</span>
	);
}

/** A synced meeting the person moved or re-lengthed: the calendar's value, as
 *  a quiet pill. Opening it (hover or tap) sets the two side by side, and the
 *  button inside is what takes the calendar's — the pill itself never acts,
 *  so a stray click cannot move an entry. */
export function CalendarDiffPill({
	entry,
	diff,
	pending,
	onUse,
}: {
	entry: EntryBlockRowEntry;
	diff: CalendarDiff;
	pending: boolean;
	onUse: () => void;
}) {
	return (
		<Popover>
			<PopoverTrigger
				openOnHover
				delay={300}
				closeDelay={100}
				render={<button type="button" className={PILL_CLASS} />}
			>
				Calendar: {calendarLabel(diff)}
			</PopoverTrigger>
			<PopoverContent
				side="bottom"
				align="start"
				className="flex w-72 flex-col gap-2 p-3"
			>
				<div className="eyebrow">Differs from your calendar</div>
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
					<dt className="text-muted-foreground">Calendar</dt>
					<dd>
						{formatDateKeyShort(diff.date ?? entry.date)} ·{" "}
						{formatClock(diff.durationSeconds ?? entry.durationSeconds)}
					</dd>
					<dt className="text-muted-foreground">Your entry</dt>
					<dd>
						{formatDateKeyShort(entry.date)} ·{" "}
						{formatClock(entry.durationSeconds)}
					</dd>
				</dl>
				<p className="text-xs text-muted-foreground">
					Your entry keeps your values. Take the calendar's and it follows the
					calendar again.
				</p>
				<Button
					size="sm"
					variant="secondary"
					className="self-start"
					disabled={pending}
					onClick={onUse}
				>
					{pending ? "Updating…" : "Use the calendar's"}
				</Button>
			</PopoverContent>
		</Popover>
	);
}

/** The sync moved, re-lengthed or renamed this on the calendar's say-so. A
 *  quiet pill in words only; opening it says what the entry was before, and
 *  "Got it" puts the notice away. */
export function CalendarChangePill({
	lines,
	changedAt,
	timezone,
	pending,
	onAcknowledge,
}: {
	lines: string[];
	changedAt: Date | string | null | undefined;
	timezone: string;
	pending: boolean;
	onAcknowledge: () => void;
}) {
	return (
		<Popover>
			<PopoverTrigger
				openOnHover
				delay={300}
				closeDelay={100}
				render={<button type="button" className={PILL_CLASS} />}
			>
				Updated automatically
			</PopoverTrigger>
			<PopoverContent
				side="bottom"
				align="start"
				className="flex w-64 flex-col gap-2 p-3"
			>
				<div className="eyebrow">Updated by your calendar</div>
				<ul className="flex flex-col gap-0.5 text-sm">
					{lines.map((line) => (
						<li key={line}>{line}</li>
					))}
				</ul>
				{changedAt && (
					<p className="text-xs text-muted-foreground">
						{formatDateKeyShort(dayKeyInTz(new Date(changedAt), timezone))} at{" "}
						{timeKeyInTz(new Date(changedAt), timezone)}
					</p>
				)}
				<Button
					size="sm"
					variant="secondary"
					className="self-start"
					disabled={pending}
					onClick={onAcknowledge}
				>
					Got it
				</Button>
			</PopoverContent>
		</Popover>
	);
}

/** A count of linked commits or pull requests, or nothing for a zero. */
export function LinkedCountBadge({
	count,
	noun,
	icon,
}: {
	count: number | undefined;
	noun: string;
	icon: ReactNode;
}) {
	if (!hasCount(count)) return null;
	return (
		<span
			className="mono flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
			title={linkedCountTitle(count, noun)}
		>
			{icon}
			{count}
		</span>
	);
}

/** The note: a button that reads it, swapped for a textarea on click. */
export function NoteField({
	note,
	shownNote,
	editing,
	onChange,
	onStartEdit,
	onBlur,
	onEscape,
}: {
	note: string;
	shownNote: string;
	editing: boolean;
	onChange: (value: string) => void;
	onStartEdit: () => void;
	onBlur: () => void;
	onEscape: () => void;
}) {
	if (editing) {
		return (
			<Textarea
				// oxlint-disable-next-line jsx-a11y/no-autofocus -- the field only exists because the person just clicked the note to edit it
				autoFocus
				value={note}
				onChange={(event) => onChange(event.target.value)}
				onBlur={onBlur}
				onKeyDown={(event) => {
					// Escape abandons the edit and puts the stored value back.
					if (event.key === "Escape") onEscape();
				}}
				placeholder="Add a note…"
				rows={1}
				className="mt-0.5 -ml-1.5 max-h-56 min-h-7 w-full resize-none overflow-y-auto rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-muted-foreground shadow-none [field-sizing:content] placeholder:text-faint hover:border-input focus-visible:border-ring focus-visible:bg-background focus-visible:text-foreground"
			/>
		);
	}
	return (
		<button
			type="button"
			aria-label={note ? `Edit note: ${note}` : "Add a note"}
			onClick={onStartEdit}
			className={cn(
				"mt-0.5 -ml-1.5 block min-h-7 w-full cursor-text rounded-md border border-transparent px-1.5 py-1 text-left text-sm wrap-anywhere whitespace-pre-wrap outline-none hover:border-input focus-visible:border-ring",
				note ? "text-muted-foreground" : "text-faint",
			)}
		>
			{shownNote || "Add a note…"}
		</button>
	);
}

/** The "Show more" / "Show less" button of a long note. */
export function ExpandNoteButton({
	expanded,
	onToggle,
}: {
	expanded: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			aria-expanded={expanded}
			onClick={onToggle}
			className="rounded-sm text-xs font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/16"
		>
			{expanded ? "Show less" : "Show more"}
		</button>
	);
}

/** A fill block's length is the day's leftover working time, recomputed on
 *  every write, so there is nothing to type into: it stays a figure.
 *  Everything else is editable in place, like the note. */
export function DurationCell({
	fillsDay,
	seconds,
	value,
	label,
	onFocus,
	onChange,
	onBlur,
	onCancel,
}: {
	fillsDay: boolean;
	seconds: number;
	value: string;
	label: string;
	onFocus: () => void;
	onChange: (value: string) => void;
	onBlur: () => void;
	onCancel: () => void;
}) {
	if (fillsDay) {
		return (
			<span
				className="mono mr-auto w-16 shrink-0 border-x border-transparent px-1.5 text-right text-base @md/entries:mt-0.5 @md/entries:mr-0"
				title="This block fills the rest of the day, so its length follows the day"
			>
				{formatClock(seconds)}
			</span>
		);
	}
	return (
		<Input
			value={value}
			onFocus={onFocus}
			onChange={(event) => onChange(event.target.value)}
			onBlur={onBlur}
			onKeyDown={(event) => {
				const action = durationKeyAction(event.key);
				if (action === "commit") event.preventDefault();
				if (action === "cancel") onCancel();
				if (action) event.currentTarget.blur();
			}}
			inputMode="decimal"
			aria-label={label}
			className="mono mr-auto h-7 w-16 shrink-0 rounded-md border-transparent px-1.5 text-right text-base hover:not-disabled:not-focus-visible:border-input focus-visible:bg-background @md/entries:mr-0"
		/>
	);
}

/** One-click overtime toggle. It is purely manual, and making people reopen
 *  the dialog for it guarantees it never gets set. Where the entry has no
 *  overtime the slot stays, unseen: the row is right-aligned, so a missing
 *  button moves the duration out of its column. */
export function OvertimeButton({
	available,
	overtime,
	pending,
	onToggle,
}: {
	available: boolean;
	overtime: boolean;
	pending: boolean;
	onToggle: () => void;
}) {
	if (!available) {
		return (
			<Button
				variant="ghost"
				size="sm"
				className="invisible"
				aria-hidden
				tabIndex={-1}
				disabled
			>
				OT
			</Button>
		);
	}
	return (
		<Button
			variant="ghost"
			size="sm"
			className={cn("text-faint", overtime && "text-warn")}
			onClick={onToggle}
			disabled={pending}
		>
			OT
		</Button>
	);
}

/** Continue the entry on the stopwatch. The same unseen-slot rule as OT: an
 *  entry a timer cannot continue keeps the button's width. */
export function StartButton({
	available,
	timing,
	pending,
	onStart,
}: {
	available: boolean;
	timing: boolean;
	pending: boolean;
	onStart: () => void;
}) {
	if (!available) {
		return (
			<Button
				variant="ghost"
				size="sm"
				className="invisible w-16"
				aria-hidden
				tabIndex={-1}
				disabled
			>
				Start
			</Button>
		);
	}
	return (
		<Button
			variant="ghost"
			size="sm"
			// Fixed, so "Timing" and "Start" take the same room.
			className={cn("w-16 text-faint", timing && "text-ok")}
			onClick={onStart}
			disabled={pending || timing}
			title={
				timing
					? "A timer is adding to this entry"
					: "Start a timer that adds to this entry"
			}
		>
			{timing ? "Timing" : "Start"}
		</Button>
	);
}
