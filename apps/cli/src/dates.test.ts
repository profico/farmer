import { describe, expect, test } from "bun:test";

import {
	type OrgClock,
	parseDay,
	parseDaySpan,
	todayKey,
	weekAround,
} from "./dates";

// 23:30 UTC on Monday 2026-09-14 is already 01:30 on Tuesday 2026-09-15 in
// Sarajevo (UTC+2 in September). Every case below depends on the org's zone
// winning over UTC, which is what the laptop of a remote worker may be on.
const NOW = new Date("2026-09-14T23:30:00Z");
const sarajevo: OrgClock = {
	timeZone: "Europe/Sarajevo",
	weekStartsOn: 1,
	now: NOW,
};
const utc: OrgClock = { timeZone: "UTC", weekStartsOn: 1, now: NOW };

describe("parseDay", () => {
	test("today is computed in the org timezone", () => {
		expect(todayKey(sarajevo)).toBe("2026-09-15");
		expect(todayKey(utc)).toBe("2026-09-14");
		expect(parseDay("today", sarajevo)).toBe("2026-09-15");
	});

	test("yesterday and tomorrow", () => {
		expect(parseDay("yesterday", sarajevo)).toBe("2026-09-14");
		expect(parseDay("Yesterday", utc)).toBe("2026-09-13");
		expect(parseDay("tomorrow", sarajevo)).toBe("2026-09-16");
	});

	test("a weekday name is the most recent one, today included", () => {
		// Today in Sarajevo is a Tuesday.
		expect(parseDay("tuesday", sarajevo)).toBe("2026-09-15");
		expect(parseDay("monday", sarajevo)).toBe("2026-09-14");
		expect(parseDay("sunday", sarajevo)).toBe("2026-09-13");
		expect(parseDay("wednesday", sarajevo)).toBe("2026-09-09");
		expect(parseDay("fri", sarajevo)).toBe("2026-09-11");
		// In UTC it is still Monday, so Tuesday is a week back.
		expect(parseDay("tuesday", utc)).toBe("2026-09-08");
	});

	test("yyyy-MM-dd, and only a day that exists", () => {
		expect(parseDay("2026-02-28", sarajevo)).toBe("2026-02-28");
		expect(() => parseDay("2026-02-30", sarajevo)).toThrow("Cannot read");
		expect(() => parseDay("14.09.2026", sarajevo)).toThrow("Cannot read");
		expect(() => parseDay("mo", sarajevo)).toThrow("Cannot read");
	});
});

describe("parseDaySpan", () => {
	test("one day or a range", () => {
		expect(parseDaySpan("today", sarajevo)).toEqual({
			from: "2026-09-15",
			to: "2026-09-15",
		});
		expect(parseDaySpan("2026-12-22..2027-01-02", sarajevo)).toEqual({
			from: "2026-12-22",
			to: "2027-01-02",
		});
	});

	test("refuses a range that ends before it starts", () => {
		expect(() => parseDaySpan("2026-09-20..2026-09-10", sarajevo)).toThrow(
			"ends before it starts",
		);
	});
});

test("weekAround starts the week on weekStartsOn", () => {
	// 2026-09-15 is a Tuesday: a Monday-start week runs 2026-09-14..2026-09-20.
	expect(weekAround("2026-09-15", 1)).toEqual({
		from: "2026-09-14",
		to: "2026-09-20",
	});
	expect(weekAround("2026-09-20", 1)).toEqual({
		from: "2026-09-14",
		to: "2026-09-20",
	});
	// A Sunday-start week instead runs Sunday to Saturday.
	expect(weekAround("2026-09-15", 0)).toEqual({
		from: "2026-09-13",
		to: "2026-09-19",
	});
	expect(weekAround("2026-09-20", 0)).toEqual({
		from: "2026-09-20",
		to: "2026-09-26",
	});
});
