import { addDays, weekdayOf } from "../lib/days";

/**
 * Months as `yyyy-MM` keys, and the bridge between a day key and the native
 * date picker. Like `lib/days.ts`, the arithmetic runs on the key itself, in
 * UTC, and never on the phone's clock.
 */

/** `2026-10` for `2026-10-06`. */
export const monthOf = (day: string) => day.slice(0, 7);

/** A month `delta` months before or after `month`. */
export const shiftMonth = (month: string, delta: number) => {
	const [year = 1970, number = 1] = month.split("-").map(Number);
	const total = year * 12 + (number - 1) + delta;
	const nextYear = Math.floor(total / 12);
	const nextMonth = ((total % 12) + 12) % 12;
	return `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}`;
};

/** Every day of a month, in order. */
export const daysOfMonth = (month: string) => {
	const first = `${month}-01`;
	const days: string[] = [];
	for (let day = first; monthOf(day) === month; day = addDays(day, 1)) {
		days.push(day);
	}
	return days;
};

/** The empty cells before the first day, in a grid whose rows start on
 *  `weekStartsOn` (0 is Sunday). */
export const leadingBlanks = (month: string, weekStartsOn: number) =>
	(weekdayOf(`${month}-01`) - weekStartsOn + 7) % 7;

/** The weekdays in the order of the workspace's week, 0 is Sunday. */
export const orderedWeekdays = (weekStartsOn: number) =>
	Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7);

/** The number of days from `from` to `to`; negative when `to` is earlier. */
export const daysBetween = (from: string, to: string) =>
	(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
	86_400_000;

/**
 * The value for the native date picker. Noon in UTC: the iOS picker is set
 * to UTC (`timeZoneName`), and the Android picker counts in UTC days, so
 * both show the day of the key.
 */
export const pickerValue = (day: string) => new Date(`${day}T12:00:00Z`);

/** The day key of a date that the native picker gave back. */
export const pickedDay = (date: Date) => date.toISOString().slice(0, 10);

/** "October 2026". */
export const monthTitle = (month: string) =>
	new Intl.DateTimeFormat(undefined, {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(`${month}-01T12:00:00Z`));

/** "Mon" for 1. */
export const weekdayName = (weekday: number) =>
	new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		timeZone: "UTC",
	}).format(new Date(Date.UTC(2026, 9, 4 + weekday, 12)));
