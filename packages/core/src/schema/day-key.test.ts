// A day key must name a day that exists.
//
// Every schema carried its own copy of the shape regex, and "2026-02-31"
// matches it. Such an entry was stored, and then no range read ever returned
// it: day keys compare as strings, so it sat between the 28th and March, on a
// day no screen shows.

import { describe, expect, test } from "bun:test";

import { parseHarvestDate } from "../lib/harvest/detect";
import { suggestDayAssemblyInput } from "./day-assembly";
import { dayKeySchema } from "./day-key";
import { listHolidaysForRangeInput } from "./holidays";
import { createRecurringBlockRuleInput } from "./recurring-block-rules";
import { absenceReportInput } from "./reports";
import {
	createTimeEntryInput,
	listTimeEntriesRangeInput,
} from "./time-entries";
import { confirmTimerInput } from "./timer";

const TASK = "00000000-0000-4000-8000-000000000001";

describe("the day key", () => {
	test("accepts a real day, a leap day included", () => {
		expect(dayKeySchema.safeParse("2026-02-28").success).toBe(true);
		expect(dayKeySchema.safeParse("2028-02-29").success).toBe(true);
	});

	test("refuses a day that does not exist", () => {
		for (const key of [
			"2026-02-31",
			"2026-02-29",
			"2026-04-31",
			"2026-13-01",
		]) {
			expect(dayKeySchema.safeParse(key).success).toBe(false);
		}
	});

	test("refuses the wrong shape", () => {
		for (const key of ["2026-2-01", "01.02.2026", "2026-02-01T00:00", ""]) {
			expect(dayKeySchema.safeParse(key).success).toBe(false);
		}
	});
});

describe("every schema that takes a day refuses an impossible one", () => {
	test("a time entry", () => {
		const entry = (date: string) =>
			createTimeEntryInput.safeParse({
				date,
				taskId: TASK,
				durationSeconds: 3600,
			}).success;
		expect(entry("2026-02-28")).toBe(true);
		expect(entry("2026-02-31")).toBe(false);
	});

	test("a range read", () => {
		expect(
			listTimeEntriesRangeInput.safeParse({
				from: "2026-02-01",
				to: "2026-02-31",
			}).success,
		).toBe(false);
		expect(
			absenceReportInput.safeParse({ from: "2026-02-30", to: "2026-03-10" })
				.success,
		).toBe(false);
		expect(
			listHolidaysForRangeInput.safeParse({
				from: "2026-02-30",
				to: "2026-03-10",
			}).success,
		).toBe(false);
	});

	test("a recurring rule's bounds", () => {
		const rule = (effectiveFrom: string) =>
			createRecurringBlockRuleInput.safeParse({
				taskId: TASK,
				daysOfWeek: [1],
				duration: "1h",
				effectiveFrom,
			}).success;
		expect(rule("2026-02-28")).toBe(true);
		expect(rule("2026-02-31")).toBe(false);
	});

	test("the day assembler and the stopwatch", () => {
		expect(
			suggestDayAssemblyInput.safeParse({ date: "2026-02-31" }).success,
		).toBe(false);
		const timer = (date: string) =>
			confirmTimerInput.safeParse({
				date,
				taskId: TASK,
				durationSeconds: 3600,
			}).success;
		expect(timer("2026-02-28")).toBe(true);
		expect(timer("2026-02-31")).toBe(false);
	});
});

describe("the Harvest parser", () => {
	test("reads an impossible date as no date, so the row is refused early", () => {
		expect(parseHarvestDate("2026-02-31")).toBeNull();
		expect(parseHarvestDate("2/31/2026")).toBeNull();
		expect(parseHarvestDate("2026-2-3")).toBe("2026-02-03");
	});
});
