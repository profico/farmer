import { describe, expect, test } from "bun:test";

import { automationWriteWindow } from "./automation-window";
import {
	countWorkingDays,
	dayKeyInTz,
	formatDurationInput,
	isValidDayKey,
	msUntilNextDay,
	MAX_DAY_SECONDS,
	parseDuration,
	parseHeadStart,
	snapToQuarterHour,
} from "./time";

const MON_FRI = new Set([1, 2, 3, 4, 5]);
const HOUR = 3600;
const MINUTE = 60;

describe("countWorkingDays", () => {
	test("counts a full Mon-Fri work week as 5", () => {
		// 2026-07-13 is a Monday, 2026-07-17 a Friday.
		expect(
			countWorkingDays("2026-07-13", "2026-07-17", MON_FRI, new Set()),
		).toBe(5);
	});

	test("excludes weekends", () => {
		// Mon 2026-07-13 .. Sun 2026-07-19 = 7 calendar days, 5 working.
		expect(
			countWorkingDays("2026-07-13", "2026-07-19", MON_FRI, new Set()),
		).toBe(5);
	});

	test("excludes holidays that fall on a working day", () => {
		const holidays = new Set(["2026-07-15"]); // a Wednesday
		expect(
			countWorkingDays("2026-07-13", "2026-07-17", MON_FRI, holidays),
		).toBe(4);
	});

	test("a holiday on a weekend does not double-subtract", () => {
		const holidays = new Set(["2026-07-18"]); // a Saturday, already excluded
		expect(
			countWorkingDays("2026-07-13", "2026-07-19", MON_FRI, holidays),
		).toBe(5);
	});

	test("single working day is 1", () => {
		expect(
			countWorkingDays("2026-07-15", "2026-07-15", MON_FRI, new Set()),
		).toBe(1);
	});

	test("respects a custom enabled-weekday set (Tue-Thu)", () => {
		const tueThu = new Set([2, 3, 4]);
		expect(
			countWorkingDays("2026-07-13", "2026-07-17", tueThu, new Set()),
		).toBe(3);
	});
});

describe("parseDuration", () => {
	test("reads the forms the placeholder promises", () => {
		expect(parseDuration("1.5")).toBe(90 * MINUTE);
		expect(parseDuration("1h30m")).toBe(90 * MINUTE);
		expect(parseDuration("1:30")).toBe(90 * MINUTE);
		expect(parseDuration("90m")).toBe(90 * MINUTE);
		expect(parseDuration("2h")).toBe(2 * HOUR);
		expect(parseDuration(".5")).toBe(30 * MINUTE);
	});

	test("reads H:MM with the hours left out", () => {
		expect(parseDuration(":30")).toBe(30 * MINUTE);
		expect(parseDuration(":05")).toBe(5 * MINUTE);
		expect(parseDuration(":")).toBeNull();
	});

	test("reads a comma as a decimal point", () => {
		// Typed by everyone here; it used to fail the character whitelist and come
		// back as null with no message on screen.
		expect(parseDuration("1,5")).toBe(90 * MINUTE);
		expect(parseDuration("0,25")).toBe(15 * MINUTE);
	});

	test("'1h30' means an hour and a half, not an hour", () => {
		// The regression this suite exists for: the unit scanner used to match the
		// "1h" and silently discard the "30".
		expect(parseDuration("1h30")).toBe(90 * MINUTE);
		expect(parseDuration("2h05")).toBe(2 * HOUR + 5 * MINUTE);
		expect(parseDuration("1 h 30")).toBe(90 * MINUTE);
	});

	test("rejects input it can only read part of", () => {
		expect(parseDuration("1h30x")).toBeNull();
		expect(parseDuration("1h 30 nonsense")).toBeNull();
		expect(parseDuration("abc")).toBeNull();
		expect(parseDuration("")).toBeNull();
		expect(parseDuration("   ")).toBeNull();
	});

	test("still evaluates an arithmetic expression of hours", () => {
		expect(parseDuration("1.5*4")).toBe(6 * HOUR);
		expect(parseDuration("(1+2)/2")).toBe(90 * MINUTE);
	});

	test("rejects a negative duration", () => {
		expect(parseDuration("-1")).toBeNull();
	});

	test("reads a long run of digits in linear time", () => {
		// A recurring rule's duration reaches this from any member, with no length
		// limit. The unit scan and the number pattern both used to backtrack in
		// quadratic time on these, which held the server for tens of seconds.
		const digits = "1".repeat(100_000);
		const start = performance.now();
		expect(parseDuration(`${digits}xh`)).toBeNull();
		expect(parseDuration(`${digits}..`)).toBeNull();
		expect(performance.now() - start).toBeLessThan(1000);
	});

	test("reads several units, with or without spaces between them", () => {
		expect(parseDuration("1h 30m")).toBe(90 * MINUTE);
		expect(parseDuration("1.5h 15m")).toBe(HOUR + 45 * MINUTE);
		expect(parseDuration("1h 30m x")).toBeNull();
	});
});

describe("snapToQuarterHour", () => {
	test("rounds to the nearest quarter hour", () => {
		expect(snapToQuarterHour(50 * MINUTE)).toBe(45 * MINUTE);
		expect(snapToQuarterHour(53 * MINUTE)).toBe(HOUR);
	});

	test("floors at one quarter hour rather than collapsing to nothing", () => {
		// The whole reason this helper exists, and the reason the dialog must not
		// re-implement it: a 6-minute entry is 15 minutes of logged time, not an
		// entry the server then rejects for being zero.
		expect(snapToQuarterHour(6 * MINUTE)).toBe(15 * MINUTE);
		expect(snapToQuarterHour(1)).toBe(15 * MINUTE);
	});
});

// One reading for the web dialog, the CLI and `startTimerInput` (issue #107).
describe("parseHeadStart", () => {
	test("reads any whole minute, not only quarter hours", () => {
		expect(parseHeadStart("20m")).toEqual({ ok: true, seconds: 20 * MINUTE });
		expect(parseHeadStart("1:07")).toEqual({
			ok: true,
			seconds: HOUR + 7 * MINUTE,
		});
	});

	test("refuses what it cannot read, and no time at all", () => {
		expect(parseHeadStart("soon")).toMatchObject({ ok: false });
		expect(parseHeadStart("0")).toEqual({
			ok: false,
			error: "Enter some time.",
		});
	});

	// Shorter than a day, so exactly a day is refused as well — the schema
	// uses the same bound, and once allowed exactly 86400.
	test("refuses a day or more", () => {
		expect(parseHeadStart("23:59")).toMatchObject({ ok: true });
		expect(parseHeadStart("24")).toEqual({
			ok: false,
			error: "A head start must be shorter than a day",
		});
		expect(parseHeadStart("25h")).toMatchObject({ ok: false });
	});

	test("refuses the person's limit in the service's own words", () => {
		expect(parseHeadStart("12", 12 * HOUR)).toEqual({
			ok: false,
			error: "A head start must be shorter than your timer limit of 12 hours",
		});
		expect(parseHeadStart("11:59", 12 * HOUR)).toMatchObject({ ok: true });
	});

	test("never allows more than a day, whatever limit it is given", () => {
		expect(parseHeadStart("24", 2 * MAX_DAY_SECONDS)).toMatchObject({
			ok: false,
		});
	});
});

describe("formatDurationInput", () => {
	test("round-trips through parseDuration", () => {
		for (const seconds of [15 * MINUTE, HOUR, 90 * MINUTE, 8 * HOUR]) {
			expect(parseDuration(formatDurationInput(seconds))).toBe(seconds);
		}
	});
});

describe("automationWriteWindow", () => {
	const TODAY = "2026-08-10";

	test("never reaches past today", () => {
		// The old meeting sync ran to today+14, filing rows onto days nobody had
		// lived yet. Showing next week's meetings is the assembler's job.
		expect(automationWriteWindow(TODAY)?.to).toBe(TODAY);
	});

	test("an unfloored automation still only gets the grace window", () => {
		// A null stamp grandfathers rows written before the *_since columns
		// existed. Grandfathered must not mean unbounded.
		expect(automationWriteWindow(TODAY)).toEqual({
			from: "2026-08-07",
			to: TODAY,
		});
	});

	test("a switch flipped inside the window narrows it", () => {
		expect(automationWriteWindow(TODAY, { since: "2026-08-09" })).toEqual({
			from: "2026-08-09",
			to: TODAY,
		});
	});

	test("a switch flipped long ago does not widen it", () => {
		// The reported failure: `since` was a floor, not a window, so the longer a
		// switch had been on the further back the engines wrote.
		expect(automationWriteWindow(TODAY, { since: "2026-01-01" })).toEqual({
			from: "2026-08-07",
			to: TODAY,
		});
	});

	test("a switch flipped after today writes nothing", () => {
		expect(automationWriteWindow(TODAY, { since: "2026-08-11" })).toBeNull();
	});

	test("the lock starts the window the day after it", () => {
		// The lock names the last CLOSED day, so the 8th being locked means the
		// 9th is the first day automation may touch.
		expect(
			automationWriteWindow(TODAY, { lockedThrough: "2026-08-08" }),
		).toEqual({ from: "2026-08-09", to: TODAY });
	});

	test("a lock covering today stops the engine entirely", () => {
		expect(automationWriteWindow(TODAY, { lockedThrough: TODAY })).toBeNull();
	});

	test("a lock older than the grace window changes nothing", () => {
		expect(
			automationWriteWindow(TODAY, { lockedThrough: "2026-06-30" }),
		).toEqual({ from: "2026-08-07", to: TODAY });
	});

	test("the tightest floor wins whichever one it is", () => {
		expect(
			automationWriteWindow(TODAY, {
				since: "2026-08-08",
				lockedThrough: "2026-08-05",
			}),
		).toEqual({ from: "2026-08-08", to: TODAY });
		expect(
			automationWriteWindow(TODAY, {
				since: "2026-08-08",
				lockedThrough: "2026-08-09",
			}),
		).toEqual({ from: "2026-08-10", to: TODAY });
	});

	test("a month-end lock holds the line on the 1st", () => {
		// The case the grace window cannot cover on its own: for the first few days
		// of every month, "today - 3" reaches back into the month that was just
		// reconciled and invoiced.
		expect(
			automationWriteWindow("2026-09-01", { lockedThrough: "2026-08-31" }),
		).toEqual({ from: "2026-09-01", to: "2026-09-01" });
		expect(
			automationWriteWindow("2026-09-01", { lockedThrough: null }),
		).toEqual({ from: "2026-08-29", to: "2026-09-01" });
	});

	// The one ceiling, and it belongs to the commit work-time engine alone. Its
	// block claims the rest of the working day and is sized from the day's WHOLE
	// target, which is a claim about a day that has been worked — so run against
	// today, a 09:15 commit produced a 7.5-hour block at 09:20 that no later tick
	// ever corrected.
	test("completeDaysOnly stops at yesterday", () => {
		expect(automationWriteWindow(TODAY, { completeDaysOnly: true })).toEqual({
			from: "2026-08-07",
			to: "2026-08-09",
		});
	});

	test("completeDaysOnly closes a window that had only today in it", () => {
		// A switch flipped today leaves nothing complete to write to. Null rather
		// than an inverted range, so the caller skips the engine outright.
		expect(
			automationWriteWindow(TODAY, {
				since: TODAY,
				completeDaysOnly: true,
			}),
		).toBeNull();
	});

	test("completeDaysOnly still respects the lock", () => {
		// Two bounds from opposite ends; neither cancels the other.
		expect(
			automationWriteWindow(TODAY, {
				lockedThrough: "2026-08-08",
				completeDaysOnly: true,
			}),
		).toEqual({ from: "2026-08-09", to: "2026-08-09" });
	});
});

describe("isValidDayKey", () => {
	test("accepts a real day", () => {
		expect(isValidDayKey("2026-08-10")).toBe(true);
		// A leap day in a leap year — the case a naive range check gets wrong in
		// the other direction.
		expect(isValidDayKey("2028-02-29")).toBe(true);
	});

	test("rejects a day that matches the shape but does not exist", () => {
		// The whole reason this exists. Every consumer compares day keys as
		// STRINGS, so an impossible date throws nowhere — it just sorts after every
		// real one, which in `automationLockedThrough` means locking the
		// automations forever.
		expect(isValidDayKey("2026-13-45")).toBe(false);
		expect(isValidDayKey("2026-02-30")).toBe(false);
		expect(isValidDayKey("2027-02-29")).toBe(false);
	});

	test("rejects anything that is not the shape at all", () => {
		expect(isValidDayKey("2026-8-10")).toBe(false);
		expect(isValidDayKey("10/08/2026")).toBe(false);
		expect(isValidDayKey("")).toBe(false);
	});
});

describe("msUntilNextDay", () => {
	const at = (iso: string) => new Date(iso);
	const HOUR_MS = 3_600_000;

	test("counts to local midnight in Europe/Zagreb", () => {
		// 2026-10-03 21:30 UTC is 23:30 in Zagreb (UTC+2), so 30 minutes remain.
		expect(msUntilNextDay(at("2026-10-03T21:30:00Z"), "Europe/Zagreb")).toBe(
			30 * 60_000,
		);
	});

	test("is a whole day at the first instant of a day", () => {
		// 2026-10-02 22:00 UTC is 00:00 on 3 October in Zagreb.
		expect(msUntilNextDay(at("2026-10-02T22:00:00Z"), "Europe/Zagreb")).toBe(
			24 * HOUR_MS,
		);
	});

	test("reads the zone, not UTC", () => {
		const now = at("2026-10-03T23:30:00Z");
		// Zagreb is already on 4 October; Los Angeles (UTC-7) is at 16:30.
		expect(msUntilNextDay(now, "Europe/Zagreb")).toBe(22.5 * HOUR_MS);
		expect(msUntilNextDay(now, "UTC")).toBe(30 * 60_000);
		expect(msUntilNextDay(now, "America/Los_Angeles")).toBe(7.5 * HOUR_MS);
	});

	test("a spring-forward day is 23 hours long", () => {
		// Zagreb 2026-03-29: 02:00 CET becomes 03:00 CEST.
		// 2026-03-28 23:00 UTC is 00:00 on 29 March (UTC+1).
		expect(msUntilNextDay(at("2026-03-28T23:00:00Z"), "Europe/Zagreb")).toBe(
			23 * HOUR_MS,
		);
	});

	test("a fall-back day is 25 hours long", () => {
		// Zagreb 2026-10-25: 03:00 CEST becomes 02:00 CET.
		// 2026-10-24 22:00 UTC is 00:00 on 25 October (UTC+2).
		expect(msUntilNextDay(at("2026-10-24T22:00:00Z"), "Europe/Zagreb")).toBe(
			25 * HOUR_MS,
		);
	});

	test("crosses a month end", () => {
		// 2026-01-31 22:00 UTC is 23:00 in Zagreb (UTC+1).
		expect(msUntilNextDay(at("2026-01-31T22:00:00Z"), "Europe/Zagreb")).toBe(
			HOUR_MS,
		);
	});

	test("crosses a year end", () => {
		expect(msUntilNextDay(at("2026-12-31T23:59:30Z"), "UTC")).toBe(30_000);
		// 31 December 20:00 in Los Angeles (UTC-8) is 2027-01-01 04:00 UTC.
		expect(
			msUntilNextDay(at("2027-01-01T04:00:00Z"), "America/Los_Angeles"),
		).toBe(4 * HOUR_MS);
	});

	test("crosses a leap day", () => {
		expect(msUntilNextDay(at("2028-02-29T12:00:00Z"), "UTC")).toBe(
			12 * HOUR_MS,
		);
	});

	test("is always positive and ends on the next day key", () => {
		for (const tz of ["Europe/Zagreb", "UTC", "America/Los_Angeles"]) {
			for (let hour = 0; hour < 48; hour++) {
				const now = new Date(Date.UTC(2026, 9, 24, hour, 15));
				const wait = msUntilNextDay(now, tz);
				expect(wait).toBeGreaterThan(0);
				expect(dayKeyInTz(new Date(now.getTime() + wait), tz)).not.toBe(
					dayKeyInTz(now, tz),
				);
				expect(dayKeyInTz(new Date(now.getTime() + wait - 1), tz)).toBe(
					dayKeyInTz(now, tz),
				);
			}
		}
	});
});
