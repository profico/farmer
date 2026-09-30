// The range ceiling on the holiday range read.
//
// `holidaySetForRange` evaluates the country's calendar once per year the range
// touches, and the range came straight from the caller with no span limit — so
// `1000-01-01 → 9999-12-31` was thousands of synchronous rule evaluations in
// one request. This pins both ends of the ceiling.

import { describe, expect, test } from "bun:test";

import { listHolidaysForRangeInput } from "./holidays";

const range = (from: string, to: string) =>
	listHolidaysForRangeInput.safeParse({ from, to });

describe("holiday range limit", () => {
	test("accepts a week and a month", () => {
		expect(range("2026-12-28", "2027-01-03").success).toBe(true);
		expect(range("2026-03-01", "2026-03-31").success).toBe(true);
	});

	test("accepts exactly the 366-day boundary", () => {
		expect(range("2026-01-01", "2027-01-02").success).toBe(true);
	});

	test("rejects one day past the boundary", () => {
		const result = range("2026-01-01", "2027-01-03");
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toMatch(/Range too large/);
	});

	// The case this exists for.
	test("rejects a span of millennia", () => {
		expect(range("1000-01-01", "9999-12-31").success).toBe(false);
	});
});
