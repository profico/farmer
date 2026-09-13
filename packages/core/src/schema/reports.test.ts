// The range ceiling on the report inputs.
//
// `from <= to` used to be the only constraint, so `2000-01-01 → 2099-12-31` was
// a request any Team Lead could make and the server answered it by scanning and
// grouping the whole entry table. The cap is cheap to state and easy to lose
// again in a refactor — it lives in one helper applied to two schemas, and this
// pins both ends of it.

import { describe, expect, test } from "bun:test";

import {
	absenceReportInput,
	overtimeReportInput,
	timeReportDetailInput,
	timeReportSummaryInput,
} from "./reports";

const summary = (from: string, to: string) =>
	timeReportSummaryInput.safeParse({ from, to, tab: "projects" });

const detail = (from: string, to: string) =>
	timeReportDetailInput.safeParse({ from, to });

const overtime = (from: string, to: string) =>
	overtimeReportInput.safeParse({ from, to });

const absence = (from: string, to: string) =>
	absenceReportInput.safeParse({ from, to });

describe("report range limits", () => {
	test("accepts an ordinary month", () => {
		expect(summary("2026-03-01", "2026-03-31").success).toBe(true);
		expect(detail("2026-03-01", "2026-03-31").success).toBe(true);
	});

	test("accepts a single day", () => {
		expect(summary("2026-03-01", "2026-03-01").success).toBe(true);
	});

	// A full calendar year is a report somebody genuinely runs, so the ceiling
	// has to clear it — including across a leap year, which is why it is 366 and
	// not 365.
	test("accepts a full leap year", () => {
		const result = summary("2024-01-01", "2024-12-31");
		expect(result.success).toBe(true);
	});

	test("accepts exactly the 366-day boundary", () => {
		expect(summary("2026-01-01", "2027-01-02").success).toBe(true);
	});

	test("rejects one day past the boundary", () => {
		const result = summary("2026-01-01", "2027-01-03");
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toMatch(/Range too large/);
	});

	// The case this exists for.
	test("rejects a century", () => {
		expect(summary("2000-01-01", "2099-12-31").success).toBe(false);
		expect(detail("2000-01-01", "2099-12-31").success).toBe(false);
	});

	test("still rejects a reversed range", () => {
		const result = summary("2026-03-31", "2026-03-01");
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toMatch(/must not be after/);
	});

	test("still rejects a malformed date key", () => {
		expect(summary("March 2026", "2026-03-31").success).toBe(false);
	});

	// Every range report must carry the same rules — the whole point of the
	// shared helper is that the summary and the drill-down cannot disagree about
	// what a legal range is, since the drill-down is reached from the summary,
	// and Overtime and Absence share the summary's period control.
	test("every range report agrees on what is legal", () => {
		const cases: [string, string][] = [
			["2026-03-01", "2026-03-31"],
			["2026-01-01", "2027-01-02"],
			["2026-01-01", "2027-01-03"],
			["2000-01-01", "2099-12-31"],
			["2026-03-31", "2026-03-01"],
		];
		for (const [from, to] of cases) {
			const legal = summary(from, to).success;
			expect(detail(from, to).success).toBe(legal);
			expect(overtime(from, to).success).toBe(legal);
			expect(absence(from, to).success).toBe(legal);
		}
	});
});
