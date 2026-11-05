/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	copyDayBody,
	copyDayMessage,
	copyWeekBody,
	copyWeekMessage,
} from "./copy";

describe("copy the previous day", () => {
	test("copies the day before into the day on screen", () => {
		expect(copyDayBody("2026-10-01")).toEqual({
			fromDate: "2026-09-30",
			toDate: "2026-10-01",
		});
	});

	test("a second copy says that the entries are already here", () => {
		expect(copyDayMessage({ copied: 0, skipped: 3, blockedDays: [] })).toBe(
			"The entries of the day before are already here.",
		);
		expect(copyDayMessage({ copied: 0, skipped: 0, blockedDays: [] })).toBe(
			"The day before has nothing to copy.",
		);
		expect(copyDayMessage({ copied: 1, skipped: 0, blockedDays: [] })).toBe(
			"Copied 1 entry.",
		);
		expect(copyDayMessage({ copied: 2, skipped: 1, blockedDays: [] })).toBe(
			"Copied 2 entries. 1 were already here.",
		);
	});
});

describe("copy the previous week", () => {
	test("copies the week before into the week on screen", () => {
		expect(copyWeekBody("2026-10-05")).toEqual({
			fromWeekStart: "2026-09-28",
			toWeekStart: "2026-10-05",
		});
	});

	test("names the days that would pass 24 hours, as a warning", () => {
		expect(
			copyWeekMessage({
				copied: 4,
				skipped: 1,
				blockedDays: ["2026-10-06", "2026-10-07"],
			}),
		).toEqual({
			message: "Copied 4 entries, 1 already here, 2 days would pass 24 hours.",
			warning: true,
		});
		expect(copyWeekMessage({ copied: 0, skipped: 0, blockedDays: [] })).toEqual(
			{ message: "The week before has nothing to copy.", warning: false },
		);
	});
});
