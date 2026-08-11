import { describe, expect, test } from "bun:test";
import {
	isMeasured,
	rollUpUtilization,
	utilizationPctOf,
} from "./utilization";

const H = 3600;

describe("the per-person percentage", () => {
	test("is Final over Expected", () => {
		expect(utilizationPctOf(120 * H, 160 * H)).toBe(75);
	});

	test("is null without an Expected figure", () => {
		expect(utilizationPctOf(120 * H, null)).toBe(null);
	});

	// A month whose fund is zero (an org that has not set one) divides by zero;
	// the answer is "not measured", not Infinity.
	test("is null when Expected is zero", () => {
		expect(utilizationPctOf(120 * H, 0)).toBe(null);
	});

	test("can exceed 100", () => {
		expect(utilizationPctOf(200 * H, 160 * H)).toBe(125);
	});
});

describe("who counts as measured", () => {
	test("a row with an Expected figure does", () => {
		expect(isMeasured({ finalSeconds: 0, expectedSeconds: H })).toBe(true);
	});

	test("a contractor with none does not", () => {
		expect(isMeasured({ finalSeconds: 100 * H, expectedSeconds: null })).toBe(
			false,
		);
	});
});

describe("the org-wide figure", () => {
	test("is a ratio of sums, not a mean of ratios", () => {
		// One full-timer at 100% and one quarter-timer at 20%. The mean of ratios
		// says 60%; the org actually delivered 168h of 200h expected.
		const rows = [
			{ finalSeconds: 160 * H, expectedSeconds: 160 * H },
			{ finalSeconds: 8 * H, expectedSeconds: 40 * H },
		];
		expect(rollUpUtilization(rows).utilizationPct).toBe(84);
	});

	// The bug the PDF headline shipped: hours in the numerator with no
	// denominator to balance them.
	test("an unmeasured person moves neither side of the ratio", () => {
		const measuredOnly = [{ finalSeconds: 120 * H, expectedSeconds: 160 * H }];
		const withContractor = [
			...measuredOnly,
			{ finalSeconds: 200 * H, expectedSeconds: null },
		];
		expect(rollUpUtilization(withContractor).utilizationPct).toBe(
			rollUpUtilization(measuredOnly).utilizationPct,
		);
		expect(rollUpUtilization(withContractor).utilizationPct).toBe(75);
	});

	test("but their hours still count toward Final", () => {
		const totals = rollUpUtilization([
			{ finalSeconds: 120 * H, expectedSeconds: 160 * H },
			{ finalSeconds: 200 * H, expectedSeconds: null },
		]);
		expect(totals.finalSeconds).toBe(320 * H);
		expect(totals.measuredFinalSeconds).toBe(120 * H);
		expect(totals.expectedSeconds).toBe(160 * H);
		expect(totals.peopleMeasured).toBe(1);
	});

	test("is null when nobody is measured", () => {
		const totals = rollUpUtilization([
			{ finalSeconds: 200 * H, expectedSeconds: null },
		]);
		expect(totals.utilizationPct).toBe(null);
		expect(totals.peopleMeasured).toBe(0);
		expect(totals.finalSeconds).toBe(200 * H);
	});

	test("an empty period is null rather than zero", () => {
		expect(rollUpUtilization([])).toEqual({
			peopleMeasured: 0,
			finalSeconds: 0,
			measuredFinalSeconds: 0,
			expectedSeconds: 0,
			utilizationPct: null,
		});
	});

	test("agrees with the per-person figure when there is one person", () => {
		const row = { finalSeconds: 137 * H, expectedSeconds: 168 * H };
		expect(rollUpUtilization([row]).utilizationPct).toBe(
			utilizationPctOf(row.finalSeconds, row.expectedSeconds),
		);
	});
});
