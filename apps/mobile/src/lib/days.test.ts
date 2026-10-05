/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	addDays,
	dayKeyInTimeZone,
	dayOfMonth,
	weekdayOf,
	weekOf,
	weekStartOf,
} from "./days";

describe("day keys", () => {
	test("add days across a month and a year", () => {
		expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
		expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
	});

	test("a week starts on the workspace's day", () => {
		// 6 October 2026 is a Tuesday.
		expect(weekdayOf("2026-10-06")).toBe(2);
		expect(weekStartOf("2026-10-06", 1)).toBe("2026-10-05");
		expect(weekStartOf("2026-10-06", 0)).toBe("2026-10-04");
		expect(weekStartOf("2026-10-05", 1)).toBe("2026-10-05");
		expect(weekOf("2026-10-06", 1)).toHaveLength(7);
		expect(weekOf("2026-10-06", 1).at(-1)).toBe("2026-10-11");
	});

	test("an instant lands on the day of the workspace's timezone", () => {
		const instant = new Date("2026-10-06T23:30:00Z");
		expect(dayKeyInTimeZone(instant, "UTC")).toBe("2026-10-06");
		expect(dayKeyInTimeZone(instant, "Europe/Sarajevo")).toBe("2026-10-07");
		expect(dayKeyInTimeZone(instant, "America/New_York")).toBe("2026-10-06");
	});

	test("the day of the month has no leading zero", () => {
		expect(dayOfMonth("2026-10-06")).toBe("6");
	});
});
