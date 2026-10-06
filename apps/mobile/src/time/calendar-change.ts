import type { CalendarChange, CalendarEvent } from "@farmer/api-client";

import { formatHours, toQuarter } from "../lib/duration";

/**
 * The calendar on an entry: the notice that the meeting sync changed it,
 * and a meeting picked from the calendar. The same words as the entry row of
 * the web app (`entry-block-row.tsx`).
 */

/** "Thu 15 Oct". */
export const shortDay = (day: string) =>
	new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	}).format(new Date(`${day}T12:00:00Z`));

/**
 * One sentence for each field that the sync changed, as "was X". The
 * server sends a key only for a field that the change wrote, so the keys
 * are the sentences: nothing is compared.
 */
export const calendarChangeSentences = (
	change: CalendarChange,
	dayLabel: (day: string) => string = shortDay,
): string[] => {
	const { from } = change;
	return [
		...(from.date != null ? [`Moved from ${dayLabel(from.date)}`] : []),
		...(from.durationSeconds != null
			? [`Was ${formatHours(from.durationSeconds)} long`]
			: []),
		// A meeting that came in with no title has nothing to quote.
		...(from.description ? [`Was called "${from.description}"`] : []),
	];
};

/** The calendar's day and length when they are not the entry's, else
 *  null. Then the person may take the calendar's values. */
export const calendarDifference = (
	entry: { date: string; durationSeconds: number },
	change: CalendarChange,
) => {
	const calendar = change.calendar;
	if (!calendar) return null;
	if (
		calendar.date === entry.date &&
		calendar.durationSeconds === entry.durationSeconds
	) {
		return null;
	}
	return calendar;
};

/** The length a picked meeting gives an entry: its length, on the
 *  15-minute grid. Its start and end do not matter. */
export const meetingSeconds = (event: CalendarEvent) =>
	toQuarter((Date.parse(event.end) - Date.parse(event.start)) / 1000);

/** "09:30", an instant in the workspace's timezone. */
export const clockTime = (iso: string, timeZone: string) =>
	new Intl.DateTimeFormat(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		timeZone,
	}).format(new Date(iso));
