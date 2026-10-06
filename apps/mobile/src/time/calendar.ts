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

// ── The native pickers ──────────────────────────────────────────────────
//
// A day key has no time zone, and a native picker works with a `Date`.
// Each source of a `Date` counts days in its own way, so each has its own
// pair of functions. A picker value and a picker result must use the same
// pair.
//
// - Android date picker (the Compose `DatePickerDialog`, also behind
//   `@expo/ui/community/datetime-picker`): the value is read as a UTC
//   day, and the result is midnight UTC. The bounds are the exception:
//   the native code reads them in the phone's own time zone.
// - Android time picker: the phone's own time zone, both ways.
// - iOS picker with `timeZoneName="UTC"` (`date-field.ios.tsx`): UTC.
// - Other iOS pickers: the phone's own time zone, both ways.

/** The platforms that have a native picker. */
export type PickerPlatform = "android" | "ios";

const pad = (value: number) => String(value).padStart(2, "0");

/** Noon in UTC. For a picker that is set to UTC, or that counts UTC days. */
export const pickerValue = (day: string) => new Date(`${day}T12:00:00Z`);

/** The day key of a date that a UTC picker gave back. */
export const pickedDay = (date: Date) => date.toISOString().slice(0, 10);

/** Noon on the day in the phone's own time zone, far from the edge of any
 *  day. */
export const localPickerValue = (day: string) => {
	const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
	return new Date(year, month - 1, date, 12);
};

/** The day key of a date that a picker gave back in the phone's own time
 *  zone. */
export const localPickedDay = (date: Date) =>
	`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** The value of a native date picker that is not set to UTC. */
export const datePickerValue = (day: string, platform: PickerPlatform) =>
	platform === "android" ? pickerValue(day) : localPickerValue(day);

/** The first or last day that a native date picker accepts. Both platforms
 *  read it in the phone's own time zone. */
export const datePickerBound = (day: string) => localPickerValue(day);

/** The day key that a native date picker chose. */
export const datePickerResult = (date: Date, platform: PickerPlatform) =>
	platform === "android" ? pickedDay(date) : localPickedDay(date);

/** "HH:mm" as a `Date` for a native time picker, in the phone's own time
 *  zone. */
export const timePickerValue = (time: string) => {
	const [hours = 0, minutes = 0] = time.split(":").map(Number);
	return new Date(2000, 0, 1, hours, minutes);
};

/** "HH:mm" of a time that a native time picker chose. */
export const timePickerResult = (date: Date) =>
	`${pad(date.getHours())}:${pad(date.getMinutes())}`;

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
