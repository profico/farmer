import { describe, expect, test } from "bun:test";
import {
	isCurrentPeriod,
	parseMonthKey,
	resolveReportPeriod,
	shiftMonthKey,
} from "./report-period";

// 2026-08-11 is a Tuesday.
const TODAY = "2026-08-11";

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
		expect(resolveReportPeriod({}, TODAY)).toEqual({
			preset: "month",
			from: "2026-08-01",
			to: "2026-08-31",
		});
	});

	test("a named month ignores today", () => {
		expect(resolveReportPeriod({ month: "2026-02" }, TODAY)).toEqual({
			preset: "month",
			from: "2026-02-01",
			to: "2026-02-28",
		});
	});

	// The timesheet starts weeks on Monday everywhere; a report that disagreed
	// would make the same seven days add up differently on two screens.
	test("a week runs Monday to Sunday around today", () => {
		expect(resolveReportPeriod({ preset: "week" }, TODAY)).toEqual({
			preset: "week",
			from: "2026-08-10",
			to: "2026-08-16",
		});
	});

	test("a week honours an explicit start and is always seven days", () => {
		const period = resolveReportPeriod(
			{ preset: "week", from: "2026-07-06" },
			TODAY,
		);
		expect(period).toEqual({
			preset: "week",
			from: "2026-07-06",
			to: "2026-07-12",
		});
	});

	test("a custom range defaults to the month start through today", () => {
		expect(resolveReportPeriod({ preset: "custom" }, TODAY)).toEqual({
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
			),
		).toEqual({ preset: "custom", from: "2026-08-20", to: "2026-08-20" });
	});

	test("from never comes after to", () => {
		for (const preset of ["month", "week", "custom"] as const) {
			const { from, to } = resolveReportPeriod({ preset }, TODAY);
			expect(from <= to).toBe(true);
		}
	});
});

describe("current period", () => {
	test("the default selection is current", () => {
		expect(isCurrentPeriod({}, TODAY)).toBe(true);
		expect(isCurrentPeriod({ preset: "week" }, TODAY)).toBe(true);
	});

	test("a past month is not", () => {
		expect(isCurrentPeriod({ month: "2026-07" }, TODAY)).toBe(false);
	});

	test("a past week is not", () => {
		expect(isCurrentPeriod({ preset: "week", from: "2026-08-03" }, TODAY)).toBe(
			false,
		);
	});
});
