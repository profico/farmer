// What a person's working day looks like: how long it is supposed to be, how
// much of it is already claimed, and what is left.
//
// Pure — no db or service imports — so the arithmetic is unit-testable and so
// `working-hours.service` can own the reads while this owns the rules. Every
// engine that needs "how long is this day" goes through here: the fill-block
// recompute (on write and on read), the day assembler, and the log-reminder
// job. They previously carried four copies of this, one of which looked the
// day up differently from the other three.

import { weekdayInTz } from "./time";

export type WorkingHoursDay = {
	dayOfWeek: number;
	enabled: boolean;
	startTime: string | null;
	endTime: string | null;
};

/**
 * Anything that can answer "is this day off for the whole org?" — the Map
 * `holidaysService.holidaySetForRange` returns, or a plain Set of day keys.
 * Structural rather than a concrete type so neither caller has to convert.
 */
export type HolidayLookup = { has: (dateKey: string) => boolean };

/** Anything that occupies part of a day. Only the two fields the rules read. */
export type DayClaim = {
	durationSeconds: number;
	fillsDay: boolean;
};

const DEFAULT_START = "09:00";
const DEFAULT_END = "17:00";

// A day without a stored row gets a synthesized Mon-Fri 9-5 default rather
// than requiring a backfill.
export const defaultDayRow = (dayOfWeek: number): WorkingHoursDay => {
	const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
	return {
		dayOfWeek,
		enabled: isWeekday,
		startTime: isWeekday ? DEFAULT_START : null,
		endTime: isWeekday ? DEFAULT_END : null,
	};
};

const timeToMinutes = (time: string): number => {
	const [hours, minutes] = time.split(":").map(Number);
	return (hours ?? 0) * 60 + (minutes ?? 0);
};

/** Expected working seconds for a day row — 0 if disabled or times are unset. */
export const dayDurationSeconds = (day: WorkingHoursDay): number => {
	if (!day.enabled || !day.startTime || !day.endTime) return 0;
	return Math.max(
		0,
		(timeToMinutes(day.endTime) - timeToMinutes(day.startTime)) * 60,
	);
};

/** The row for a weekday, looked up BY `dayOfWeek` rather than by array index.
 *
 *  `workingHoursService.list` happens to return exactly 7 rows in weekday
 *  order, so indexing agrees with this today — but nothing states that, and a
 *  caller that indexed a filtered or partial list would silently read the
 *  wrong day's hours. */
export const dayForWeekday = (
	workingHours: WorkingHoursDay[],
	weekday: number,
): WorkingHoursDay | undefined =>
	workingHours.find((d) => d.dayOfWeek === weekday);

/** The day's expected working seconds — the target a fill block expands up to.
 *  0 when the date is not a scheduled working day.
 *
 *  `holidays` is REQUIRED, and required on purpose. A public holiday is a
 *  non-working day exactly the way a Saturday is, and the engines already got
 *  Saturday right for free: a weekend is disabled in `memberWorkingHoursDay`, so
 *  the target is 0 and no fill block is written. Holidays live in a different
 *  table and so were simply never asked about — one commit pushed on Epiphany
 *  produced a full 8-hour "rest of day" block, against a monthly fund that
 *  `hourFundService.suggestForMonth` had already excluded that day from.
 *
 *  An optional parameter would have let every existing call site keep the bug
 *  while still compiling, which is the one thing this must not do. Pass an
 *  empty Set only where you mean "holidays cannot apply here". */
export const targetSecondsFor = (
	workingHours: WorkingHoursDay[],
	dateKey: string,
	tz: string,
	holidays: HolidayLookup,
): number => {
	if (holidays.has(dateKey)) return 0;
	const day = dayForWeekday(workingHours, weekdayInTz(dateKey, tz));
	return day ? dayDurationSeconds(day) : 0;
};

/** For the handful of call sites where the org calendar genuinely cannot apply
 *  (unit tests of the weekday math, callers that have already excluded
 *  holidays themselves). Named so it reads as a decision at the call site. */
export const NO_HOLIDAYS: HolidayLookup = { has: () => false };

/** Seconds of the day already claimed.
 *
 *  Fill blocks are excluded on purpose: a fill block's duration is DERIVED from
 *  what is left, so counting it here would make it consume its own budget and
 *  collapse to zero. This is the one rule every copy of this arithmetic had to
 *  restate in a comment; it is stated here instead. */
export const spokenForSeconds = (claims: DayClaim[]): number =>
	claims
		.filter((c) => !c.fillsDay)
		.reduce((sum, c) => sum + c.durationSeconds, 0);

/** Every second logged on the day, fill blocks included — what the person sees
 *  as "logged today", as opposed to what is available to claim. */
export const loggedSeconds = (claims: DayClaim[]): number =>
	claims.reduce((sum, c) => sum + c.durationSeconds, 0);

/** The most time that may sit on one day, in seconds.
 *
 *  A per-ENTRY ceiling has always existed (schema/time-entries), but nothing
 *  bounded the day itself, so any bulk write — `copyDay` above all — could stack
 *  a day arbitrarily high one click at a time. A day is 24 hours; that is the
 *  only ceiling that needs no policy discussion.
 *
 *  Lives in `./time`, so the CLI can read it too; re-exported here, where
 *  every engine already looks for it. */
export { MAX_DAY_SECONDS } from "./time";

/** What is left of the day after the given claims, floored at 0.
 *
 *  Also the size a fill block should be: `remainingSeconds(target, spokenFor)`.
 *  Extra claims (proposed meetings, a carved-out break) subtract on top. */
export const remainingSeconds = (
	targetSeconds: number,
	...claimed: number[]
): number =>
	Math.max(
		0,
		targetSeconds - claimed.reduce((sum, seconds) => sum + seconds, 0),
	);
