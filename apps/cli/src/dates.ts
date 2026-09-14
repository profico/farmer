import {
	addDaysToKey,
	dayKeyInTz,
	isValidDayKey,
	startOfWeekKey,
	type WeekStartsOn,
	weekdayInTz,
} from "@farmer/core/lib/time";

import { UsageError } from "./errors";

/**
 * "Now" as the organization sees it. Every relative date the CLI reads is
 * resolved in the ORG's timezone, not the laptop's: somebody working from a
 * timezone eight hours away logs against the organization's calendar, which is
 * the calendar every report reads. `weekStartsOn` is the same idea for a week:
 * the organization's own start day, not an assumed Monday.
 */
export type OrgClock = {
	timeZone: string;
	weekStartsOn: WeekStartsOn;
	now: Date;
};

export type DaySpan = { from: string; to: string };

const WEEKDAYS = [
	"sunday",
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
];

export const todayKey = (clock: OrgClock): string =>
	dayKeyInTz(clock.now, clock.timeZone);

const weekdayIndex = (word: string): number => {
	if (word.length < 3) return -1;
	return WEEKDAYS.findIndex((day) => day.startsWith(word));
};

/**
 * Reads `today`, `yesterday`, `tomorrow`, a weekday name, or `yyyy-MM-dd`.
 *
 * A weekday is the most recent one, today included: `friday` on a Friday is
 * today, and on a Monday it is three days ago. Time is logged after it is
 * worked, so the past is the reading that is almost always meant. Three letters
 * are enough (`fri`).
 */
export const parseDay = (input: string, clock: OrgClock): string => {
	const word = input.trim().toLowerCase();
	const today = todayKey(clock);
	if (word === "today") return today;
	if (word === "yesterday") return addDaysToKey(today, -1);
	if (word === "tomorrow") return addDaysToKey(today, 1);

	const weekday = weekdayIndex(word);
	if (weekday !== -1) {
		const back = (weekdayInTz(today, clock.timeZone) - weekday + 7) % 7;
		return addDaysToKey(today, -back);
	}

	if (isValidDayKey(word)) return word;
	throw new UsageError(
		`Cannot read "${input}" as a date. Use today, yesterday, a weekday name or yyyy-MM-dd.`,
	);
};

/** `<from>` or `<from>..<to>`, as `farmer off` takes it. */
export const parseDaySpan = (input: string, clock: OrgClock): DaySpan => {
	const [fromText, toText, extra] = input.split("..");
	if (extra !== undefined || !fromText) {
		throw new UsageError(`Cannot read "${input}" as a date or a range.`);
	}
	const from = parseDay(fromText, clock);
	const to = toText ? parseDay(toText, clock) : from;
	if (to < from) {
		throw new UsageError(`The range ${from}..${to} ends before it starts.`);
	}
	return { from, to };
};

/** The seven-day span around `day`, starting on `weekStartsOn`. */
export const weekAround = (
	day: string,
	weekStartsOn: WeekStartsOn,
): DaySpan => {
	const from = startOfWeekKey(day, weekStartsOn);
	return { from, to: addDaysToKey(from, 6) };
};
