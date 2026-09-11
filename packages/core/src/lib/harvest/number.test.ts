import { describe, expect, test } from "bun:test";

import {
	hoursToSeconds,
	parseHarvestNumber,
	roundToQuarterHour,
} from "./number";

describe("parseHarvestNumber", () => {
	test("empty is null", () => {
		expect(parseHarvestNumber("")).toBeNull();
		expect(parseHarvestNumber("   ")).toBeNull();
	});

	test("a plain integer", () => {
		expect(parseHarvestNumber("8")).toBe(8);
	});

	test("decimal comma, one digit", () => {
		expect(parseHarvestNumber("0,25")).toBeCloseTo(0.25);
	});

	test("decimal point, one digit", () => {
		expect(parseHarvestNumber("1.5")).toBe(1.5);
	});

	test("decimal comma with a trailing zero", () => {
		expect(parseHarvestNumber("6,0")).toBe(6);
	});

	test("decimal comma, thousands dot (both separators present)", () => {
		expect(parseHarvestNumber("10.773,68")).toBeCloseTo(10773.68);
	});

	test("decimal point, thousands comma (both separators present)", () => {
		expect(parseHarvestNumber("10,773.68")).toBeCloseTo(10773.68);
	});

	test("multiple thousands groups with a decimal comma", () => {
		expect(parseHarvestNumber("1.234.567,89")).toBeCloseTo(1234567.89);
	});

	test("multiple thousands groups with a decimal point", () => {
		expect(parseHarvestNumber("1,234,567.89")).toBeCloseTo(1234567.89);
	});

	test("a leading minus sign", () => {
		expect(parseHarvestNumber("-8,25")).toBeCloseTo(-8.25);
	});

	// Real values from harvest_project_list.csv's Total Hours column.
	test("real decimal-comma values from the project export", () => {
		expect(parseHarvestNumber("877,98")).toBeCloseTo(877.98);
		expect(parseHarvestNumber("1.015,09")).toBeCloseTo(1015.09);
		expect(parseHarvestNumber("21.646,61")).toBeCloseTo(21646.61);
	});

	// Real values from harvest_people_list.csv's Capacity column: plain
	// decimal point, no thousands separator at all.
	test("real decimal-point values from the people export", () => {
		expect(parseHarvestNumber("40.0")).toBe(40);
		expect(parseHarvestNumber("25.0")).toBe(25);
	});

	describe("ambiguous single-separator cases", () => {
		test("a lone comma with exactly 3 trailing digits reads as thousands grouping", () => {
			expect(parseHarvestNumber("10,773")).toBe(10773);
		});

		test("more than one lone comma reads every one as thousands grouping", () => {
			expect(parseHarvestNumber("1,234,567")).toBe(1234567);
		});

		test("a lone comma with 1 or 2 trailing digits reads as decimal", () => {
			expect(parseHarvestNumber("10,7")).toBeCloseTo(10.7);
			expect(parseHarvestNumber("10,68")).toBeCloseTo(10.68);
		});

		test("a lone comma with 4+ trailing digits reads as decimal, since a real thousands group is exactly 3 digits", () => {
			expect(parseHarvestNumber("10,6800")).toBeCloseTo(10.68);
		});

		test("a single dot with 3 trailing digits and no other separator reads as decimal (no grouping evidence)", () => {
			expect(parseHarvestNumber("1.234")).toBeCloseTo(1.234);
		});

		test("more than one dot with the last one holding 3 trailing digits reads as thousands grouping", () => {
			expect(parseHarvestNumber("1.234.567")).toBe(1234567);
		});

		test("a single dot with 1 or 2 trailing digits reads as decimal", () => {
			expect(parseHarvestNumber("10.7")).toBeCloseTo(10.7);
			expect(parseHarvestNumber("10.68")).toBeCloseTo(10.68);
		});
	});
});

describe("hoursToSeconds", () => {
	test("whole hours", () => {
		expect(hoursToSeconds(1)).toBe(3600);
	});

	test("a quarter hour", () => {
		expect(hoursToSeconds(0.25)).toBe(900);
	});

	test("rounds to the nearest second", () => {
		expect(hoursToSeconds(1 / 7)).toBe(514);
	});
});

describe("roundToQuarterHour", () => {
	test("zero rounds up to the 15-minute minimum", () => {
		expect(roundToQuarterHour(0)).toBe(900);
	});

	test("well below one step rounds up to the minimum", () => {
		expect(roundToQuarterHour(449)).toBe(900);
	});

	test("just below the halfway point of the next step rounds down", () => {
		expect(roundToQuarterHour(1349)).toBe(900);
	});

	test("exactly halfway rounds up", () => {
		expect(roundToQuarterHour(1350)).toBe(1800);
	});

	test("an exact multiple of 900 is unchanged", () => {
		expect(roundToQuarterHour(1800)).toBe(1800);
	});
});
