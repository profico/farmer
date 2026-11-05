import { parseDuration, snapToQuarterHour } from "@farmer/core/lib/time";

import type { EntryBlockRowEntry } from "./entry-block-row.tsx";

// Notes longer than this are cut on the row until "Show more" is pressed.
export const NOTE_LIMIT = 220;

/** The note as the row shows it: whole, or cut at `NOTE_LIMIT` characters
 *  while it is not expanded. `isLong` says whether a cut applies at all. */
export function noteView(note: string, expanded: boolean) {
	const isLong = note.length > NOTE_LIMIT;
	const shownNote =
		isLong && !expanded ? `${note.slice(0, NOTE_LIMIT).trimEnd()}…` : note;
	return { isLong, shownNote };
}

/** True when the draft differs from the stored note, so a save is needed. */
export function noteChanged(note: string, stored: string | null): boolean {
	return note.trimEnd() !== (stored ?? "");
}

/** The message of a failed call, or the fallback when it has none. */
export function errorMessage(
	error: { message?: string },
	fallback: string,
): string {
	return error.message ?? fallback;
}

/** An entry a timer can continue and a person can mark as overtime: not an
 *  absence and not a fill block. */
export function isWorkEntry(
	entry: Pick<EntryBlockRowEntry, "fillsDay"> & {
		task: Pick<EntryBlockRowEntry["task"], "isAbsence">;
	},
): boolean {
	return !entry.task.isAbsence && !entry.fillsDay;
}

/** True when a count is worth a badge on the row. */
export function hasCount(count: number | undefined): count is number {
	return !!count && count > 0;
}

/** The hover text of a count badge, such as "2 linked commits". */
export function linkedCountTitle(count: number, noun: string): string {
	return `${count} linked ${noun}${count === 1 ? "" : "s"}`;
}

/** The hover text of the Google Calendar mark. */
export function calendarMarkTitle(
	dateLabel: string,
	timeLabel: string | null,
): string {
	return timeLabel
		? `From Google Calendar · ${dateLabel} at ${timeLabel}`
		: "From Google Calendar";
}

/** What a key press in the duration box asks for. */
export function durationKeyAction(key: string): "commit" | "cancel" | null {
	if (key === "Enter") return "commit";
	if (key === "Escape") return "cancel";
	return null;
}

export type DurationEdit =
	| { kind: "abandon" }
	| { kind: "invalid" }
	| { kind: "unchanged"; snapped: number }
	| { kind: "save"; snapped: number };

/** Reads what the person typed in the duration box. An empty box abandons the
 *  edit, text that is not a length is invalid, and a length snaps to the
 *  quarter hour. A snapped length equal to the stored one needs no save. */
export function readDurationEdit(
	input: string,
	storedSeconds: number,
): DurationEdit {
	const trimmed = input.trim();
	if (trimmed === "") return { kind: "abandon" };
	const parsed = parseDuration(trimmed);
	if (parsed == null || parsed <= 0) return { kind: "invalid" };
	const snapped = snapToQuarterHour(parsed);
	if (snapped === storedSeconds) return { kind: "unchanged", snapped };
	return { kind: "save", snapped };
}
