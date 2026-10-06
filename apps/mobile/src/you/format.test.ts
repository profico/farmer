/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	clockOfPickedTime,
	daysSummary,
	descriptionRequiredFor,
	hoursLabel,
	keyOfPickedDate,
	orderedWeekdays,
	pickerDateOf,
	pickerTimeOf,
	shiftMonth,
	taskGroupLabel,
} from "./format";

describe("weekdays", () => {
	test("the week starts on the workspace's day", () => {
		expect(orderedWeekdays(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
		expect(orderedWeekdays(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
	});

	test("a set of days has a short name", () => {
		expect(daysSummary([1, 2, 3, 4, 5], 1)).toBe("Monday to Friday");
		expect(daysSummary([0, 1, 2, 3, 4, 5, 6], 1)).toBe("Every day");
		expect(daysSummary([0, 3, 1], 1)).toBe("Mon, Wed, Sun");
	});
});

describe("durations", () => {
	test("hours and minutes in words", () => {
		expect(hoursLabel(8 * 3600)).toBe("8 hours");
		expect(hoursLabel(30 * 60)).toBe("30 minutes");
		expect(hoursLabel(3600 + 60)).toBe("1 hour 1 minute");
		expect(hoursLabel(0)).toBe("0 minutes");
	});
});

describe("native pickers", () => {
	test("an Android date is midnight in UTC", () => {
		expect(keyOfPickedDate(new Date(Date.UTC(2026, 9, 6)), "android")).toBe(
			"2026-10-06",
		);
	});

	test("an iOS date is read in the phone's time zone", () => {
		expect(keyOfPickedDate(new Date(2026, 9, 6, 23, 30), "ios")).toBe(
			"2026-10-06",
		);
		expect(keyOfPickedDate(pickerDateOf("2026-01-31"), "ios")).toBe(
			"2026-01-31",
		);
	});

	test("a time goes to the picker and back unchanged", () => {
		expect(clockOfPickedTime(pickerTimeOf("09:05"))).toBe("09:05");
		expect(clockOfPickedTime(pickerTimeOf("17:30"))).toBe("17:30");
	});
});

describe("months", () => {
	test("months move across a year", () => {
		expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
		expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
	});
});

describe("tasks", () => {
	test("a group the app does not know keeps its name", () => {
		expect(taskGroupLabel("time_off")).toBe("Time off");
		expect(taskGroupLabel("research")).toBe("research");
	});

	test("only worked time needs a note", () => {
		expect(descriptionRequiredFor({ isAbsence: false, systemKey: null })).toBe(
			true,
		);
		expect(
			descriptionRequiredFor({ isAbsence: false, systemKey: "break" }),
		).toBe(false);
		expect(descriptionRequiredFor({ isAbsence: true, systemKey: null })).toBe(
			false,
		);
	});
});
