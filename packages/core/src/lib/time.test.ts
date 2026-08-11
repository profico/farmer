import { describe, expect, test } from "bun:test";
import {
	countWorkingDays,
	formatDurationInput,
	parseDuration,
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

describe("formatDurationInput", () => {
	test("round-trips through parseDuration", () => {
		for (const seconds of [15 * MINUTE, HOUR, 90 * MINUTE, 8 * HOUR]) {
			expect(parseDuration(formatDurationInput(seconds))).toBe(seconds);
		}
	});
});
