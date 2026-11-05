/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	daysBetween,
	daysOfMonth,
	leadingBlanks,
	monthOf,
	orderedWeekdays,
	datePickerBound,
	datePickerResult,
	datePickerValue,
	localPickedDay,
	localPickerValue,
	pickedDay,
	pickerValue,
	shiftMonth,
	timePickerResult,
	timePickerValue,
} from "./calendar";

describe("months", () => {
	test("a month moves across a year", () => {
		expect(shiftMonth("2026-12", 1)).toBe("2027-01");
		expect(shiftMonth("2026-01", -1)).toBe("2025-12");
		expect(shiftMonth("2026-10", -22)).toBe("2024-12");
	});

	test("a month holds its own days only", () => {
		expect(daysOfMonth("2026-02")).toHaveLength(28);
		expect(daysOfMonth("2028-02")).toHaveLength(29);
		expect(daysOfMonth("2026-10").at(-1)).toBe("2026-10-31");
		expect(monthOf("2026-10-06")).toBe("2026-10");
	});

	test("the first row starts on the workspace's day", () => {
		// 1 October 2026 is a Thursday.
		expect(leadingBlanks("2026-10", 1)).toBe(3);
		expect(leadingBlanks("2026-10", 0)).toBe(4);
		expect(leadingBlanks("2026-10", 4)).toBe(0);
		expect(orderedWeekdays(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
	});

	test("a span counts whole days in both directions", () => {
		expect(daysBetween("2026-10-06", "2026-10-06")).toBe(0);
		expect(daysBetween("2026-10-06", "2026-12-07")).toBe(62);
		expect(daysBetween("2026-10-06", "2026-10-05")).toBe(-1);
	});
});

describe("the native date picker", () => {
	test("a day goes in and comes back unchanged", () => {
		expect(pickedDay(pickerValue("2026-03-29"))).toBe("2026-03-29");
	});

	test("a day that Android gives back at UTC midnight keeps its key", () => {
		expect(pickedDay(new Date(Date.UTC(2026, 9, 31)))).toBe("2026-10-31");
	});
});

// `bun run test` runs the suite under the host zone, America/New_York and
// Pacific/Auckland (see the `test` script of package.json).
const DAYS = ["2026-01-01", "2026-03-29", "2026-10-06", "2026-12-31"];

describe("the Android date picker", () => {
	test("a day goes in and comes back unchanged", () => {
		for (const day of DAYS) {
			expect(datePickerResult(datePickerValue(day, "android"), "android")).toBe(
				day,
			);
		}
	});

	test("the value is a UTC day, which the native picker reads as that day", () => {
		for (const day of DAYS) {
			expect(datePickerValue(day, "android").toISOString()).toBe(
				`${day}T12:00:00.000Z`,
			);
		}
	});

	test("midnight UTC, as the picker gives it, is the day of the key", () => {
		expect(datePickerResult(new Date(Date.UTC(2026, 9, 6)), "android")).toBe(
			"2026-10-06",
		);
	});

	test("a bound is a time on the day in the phone's time zone", () => {
		for (const day of DAYS) {
			expect(localPickedDay(datePickerBound(day))).toBe(day);
		}
	});
});

describe("the iOS date picker", () => {
	test("a day goes in and comes back unchanged", () => {
		for (const day of DAYS) {
			expect(datePickerResult(datePickerValue(day, "ios"), "ios")).toBe(day);
		}
	});

	test("a late time on the day keeps its key", () => {
		expect(datePickerResult(new Date(2026, 9, 6, 23, 30), "ios")).toBe(
			"2026-10-06",
		);
		expect(localPickedDay(localPickerValue("2026-01-31"))).toBe("2026-01-31");
	});
});

describe("the native time picker", () => {
	test("a time goes in and comes back unchanged", () => {
		expect(timePickerResult(timePickerValue("09:05"))).toBe("09:05");
		expect(timePickerResult(timePickerValue("17:30"))).toBe("17:30");
		expect(timePickerResult(timePickerValue("00:00"))).toBe("00:00");
	});
});
