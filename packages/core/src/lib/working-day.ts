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
 *  0 when the date is not a scheduled working day. */
export const targetSecondsFor = (
	workingHours: WorkingHoursDay[],
	dateKey: string,
	tz: string,
): number => {
	const day = dayForWeekday(workingHours, weekdayInTz(dateKey, tz));
	return day ? dayDurationSeconds(day) : 0;
};

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
