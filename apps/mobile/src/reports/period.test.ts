/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	choosePreset,
	endOfMonth,
	isCurrentPeriod,
	periodLabel,
	resolvePeriod,
	shiftMonth,
	spanDays,
	stepPeriod,
} from "./period";

// 6 October 2026 is a Tuesday. The week starts on Monday (1).
const TODAY = "2026-10-06";
const MONDAY = 1;

describe("the period of a report", () => {
	test("no choice is this month", () => {
		expect(resolvePeriod({}, TODAY, MONDAY)).toEqual({
			preset: "month",
			from: "2026-10-01",
			to: "2026-10-31",
		});
	});

	test("a week starts on the day of the workspace", () => {
		expect(resolvePeriod({ preset: "week" }, TODAY, MONDAY)).toEqual({
			preset: "week",
			from: "2026-10-05",
			to: "2026-10-11",
		});
		expect(resolvePeriod({ preset: "week" }, TODAY, 0).from).toBe("2026-10-04");
	});

	test("a quarter and a year hold the anchor month", () => {
		expect(
			resolvePeriod({ preset: "quarter", month: "2026-08" }, TODAY, MONDAY),
		).toEqual({ preset: "quarter", from: "2026-07-01", to: "2026-09-30" });
		expect(resolvePeriod({ preset: "year" }, TODAY, MONDAY)).toEqual({
			preset: "year",
			from: "2026-01-01",
			to: "2026-12-31",
		});
	});

	test("a custom range is put in order and kept to 366 days", () => {
		expect(
			resolvePeriod(
				{ preset: "custom", from: "2026-05-10", to: "2026-05-01" },
				TODAY,
				MONDAY,
			),
		).toEqual({ preset: "custom", from: "2026-05-10", to: "2026-05-10" });
		expect(
			resolvePeriod(
				{ preset: "custom", from: "2020-01-01", to: "2026-01-01" },
				TODAY,
				MONDAY,
			).to,
		).toBe("2021-01-01");
	});

	test("a step moves by the unit of the preset", () => {
		expect(stepPeriod({}, -1, TODAY, MONDAY)).toEqual({ month: "2026-09" });
		expect(stepPeriod({ preset: "quarter" }, 1, TODAY, MONDAY)).toEqual({
			preset: "quarter",
			month: "2027-01",
		});
		expect(stepPeriod({ preset: "year" }, -1, TODAY, MONDAY).month).toBe(
			"2025-10",
		);
		expect(stepPeriod({ preset: "week" }, 1, TODAY, MONDAY).from).toBe(
			"2026-10-12",
		);
	});

	test("a new preset starts at now, and custom keeps the range", () => {
		const august = { month: "2026-08" };
		expect(choosePreset(august, "week", TODAY, MONDAY)).toEqual({
			preset: "week",
		});
		expect(choosePreset(august, "custom", TODAY, MONDAY)).toEqual({
			preset: "custom",
			month: "2026-08",
			from: "2026-08-01",
			to: "2026-08-31",
		});
	});

	test("the current period is known", () => {
		expect(isCurrentPeriod({}, TODAY, MONDAY)).toBe(true);
		expect(isCurrentPeriod({ month: "2026-09" }, TODAY, MONDAY)).toBe(false);
		expect(
			isCurrentPeriod({ preset: "quarter", month: "2026-11" }, TODAY, MONDAY),
		).toBe(true);
		expect(
			isCurrentPeriod({ preset: "week", from: "2026-09-28" }, TODAY, MONDAY),
		).toBe(false);
	});

	test("the label says the period", () => {
		expect(periodLabel({}, TODAY, MONDAY)).toBe("October 2026");
		expect(periodLabel({ preset: "quarter" }, TODAY, MONDAY)).toBe("Q4 2026");
		expect(periodLabel({ preset: "year" }, TODAY, MONDAY)).toBe("2026");
		expect(periodLabel({ preset: "week" }, TODAY, MONDAY)).toBe(
			"5 Oct 2026 - 11 Oct 2026",
		);
	});

	test("month arithmetic rolls the year and knows leap years", () => {
		expect(shiftMonth("2026-12", 1)).toBe("2027-01");
		expect(shiftMonth("2026-01", -13)).toBe("2024-12");
		expect(endOfMonth("2028-02")).toBe("2028-02-29");
		expect(spanDays("2026-10-01", "2026-10-31")).toBe(31);
	});
});
