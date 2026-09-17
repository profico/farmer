import { describe, expect, test } from "bun:test";

import {
	isCurrentPeriod,
	parseMonthKey,
	resolveReportPeriod,
	shiftMonthKey,
} from "./report-period";
import type { WeekStartsOn } from "./time";

// 2026-08-11 is a Tuesday.
const TODAY = "2026-08-11";

const MONDAY: WeekStartsOn = 1;

const SUNDAY: WeekStartsOn = 0;

describe("month keys", () => {
	test("parse", () => {
		expect(parseMonthKey("2026-08")).toEqual({ year: 2026, month: 8 });
	});

	test("shift forward and back", () => {
		expect(shiftMonthKey("2026-08", 1)).toBe("2026-09");
		expect(shiftMonthKey("2026-08", -1)).toBe("2026-07");
	});

	test("shift across the year boundary in both directions", () => {
		expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
		expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
	});

	test("shift by more than a year", () => {
		expect(shiftMonthKey("2026-08", 14)).toBe("2027-10");
		expect(shiftMonthKey("2026-08", -20)).toBe("2024-12");
	});

	test("the month is always two digits", () => {
		expect(shiftMonthKey("2026-10", -1)).toBe("2026-09");
		expect(shiftMonthKey("2026-01", 0)).toBe("2026-01");
	});
});

describe("resolving a period", () => {
	test("an empty selection is the current month", () => {
		expect(resolveReportPeriod({}, TODAY, MONDAY)).toEqual({
			preset: "month",
			from: "2026-08-01",
			to: "2026-08-31",
		});
	});

	test("a named month ignores today", () => {
		expect(resolveReportPeriod({ month: "2026-02" }, TODAY, MONDAY)).toEqual({
			preset: "month",
			from: "2026-02-01",
			to: "2026-02-28",
		});
	});

	// The timesheet starts weeks on the org's day; a report that disagreed
	// would make the same seven days add up differently on two screens.
	test("a week runs Monday to Sunday around today", () => {
		expect(resolveReportPeriod({ preset: "week" }, TODAY, MONDAY)).toEqual({
			preset: "week",
			from: "2026-08-10",
			to: "2026-08-16",
		});
	});

	test("a Sunday org's week runs Sunday to Saturday around today", () => {
		expect(resolveReportPeriod({ preset: "week" }, TODAY, SUNDAY)).toEqual({
			preset: "week",
			from: "2026-08-09",
			to: "2026-08-15",
		});
	});

	// A Sunday is the last day of a Monday week and the first of a Sunday one.
	test("a Sunday belongs to a different week under each start", () => {
		const sunday = "2026-08-16";
		expect(resolveReportPeriod({ preset: "week" }, sunday, MONDAY).from).toBe(
			"2026-08-10",
		);
		expect(resolveReportPeriod({ preset: "week" }, sunday, SUNDAY).from).toBe(
			"2026-08-16",
		);
	});

	test("a week honours an explicit start and is always seven days", () => {
		const period = resolveReportPeriod(
			{ preset: "week", from: "2026-07-06" },
			TODAY,
			MONDAY,
		);

		expect(period).toEqual({
			preset: "week",
			from: "2026-07-06",
			to: "2026-07-12",
		});
	});

	test("a custom range defaults to the month start through today", () => {
		expect(resolveReportPeriod({ preset: "custom" }, TODAY, MONDAY)).toEqual({
			preset: "custom",
			from: "2026-08-01",
			to: TODAY,
		});
	});

	// Mid-edit in the date pickers, `to` can land before `from`. That is not an
	// error screen; it collapses to the day the user has actually set.
	test("an inverted custom range collapses rather than inverting", () => {
		expect(
			resolveReportPeriod(
				{ preset: "custom", from: "2026-08-20", to: "2026-08-01" },
				TODAY,
				MONDAY,
			),
		).toEqual({ preset: "custom", from: "2026-08-20", to: "2026-08-20" });
	});

	test("from never comes after to", () => {
		for (const preset of ["month", "week", "custom"] as const) {
			const { from, to } = resolveReportPeriod({ preset }, TODAY, MONDAY);
			expect(from <= to).toBe(true);
		}
	});
});

describe("current period", () => {
	test("the default selection is current", () => {
		expect(isCurrentPeriod({}, TODAY, MONDAY)).toBe(true);
		expect(isCurrentPeriod({ preset: "week" }, TODAY, MONDAY)).toBe(true);
		expect(isCurrentPeriod({ preset: "week" }, TODAY, SUNDAY)).toBe(true);
	});

	test("a past month is not", () => {
		expect(isCurrentPeriod({ month: "2026-07" }, TODAY, MONDAY)).toBe(false);
	});

	test("a past week is not", () => {
		expect(
			isCurrentPeriod({ preset: "week", from: "2026-08-03" }, TODAY, MONDAY),
		).toBe(false);
	});

	// A Monday-started week is not the current week of a Sunday org.
	test("a week from another start day is not current", () => {
		expect(
			isCurrentPeriod({ preset: "week", from: "2026-08-10" }, TODAY, SUNDAY),
		).toBe(false);
	});
});
