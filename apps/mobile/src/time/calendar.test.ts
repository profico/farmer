/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	daysBetween,
	daysOfMonth,
	leadingBlanks,
	monthOf,
	orderedWeekdays,
	pickedDay,
	pickerValue,
	shiftMonth,
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
