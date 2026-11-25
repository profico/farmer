import { describe, expect, test } from "bun:test";

import {
	hoursHeadline,
	monthsHeadline,
	projectsHeadline,
	yearChange,
} from "./headlines.ts";

describe("yearChange", () => {
	test("compares the projection, not the part of a year, in December", () => {
		// 900h so far, 1,000h projected, 1,000h last year: level, not 10% down.
		expect(yearChange(900, 1000, 1000)).toBe(0);
	});

	test("has nothing to compare against an empty previous year", () => {
		expect(yearChange(500, null, 0)).toBeNull();
		expect(yearChange(500, null, null)).toBeNull();
	});

	test("does not set a full year against a part year", () => {
		// Joined in the autumn: 300h last year against 1,600h this year.
		expect(yearChange(1600, null, 300)).toBeNull();
	});
});

describe("hoursHeadline", () => {
	test("names the change and marks it", () => {
		const line = hoursHeadline({
			year: 2026,
			change: 12,
			complete: true,
			workingDays: 200,
		});
		expect(line).toEqual({ text: "12% more than 2025.", mark: "12% more" });
	});

	test("speaks of pace while the year is open", () => {
		const line = hoursHeadline({
			year: 2026,
			change: -20,
			complete: false,
			workingDays: 150,
		});
		expect(line.text).toBe("On pace for 20% less than 2025.");
	});

	test("a small change is not news", () => {
		const line = hoursHeadline({
			year: 2026,
			change: 3,
			complete: true,
			workingDays: 100,
		});
		expect(line.text).toBe("Every one of them on the record.");
	});
});

describe("monthsHeadline", () => {
	test("a month well above the rest ran hot", () => {
		expect(monthsHeadline("March", [100, 100, 300, 100]).text).toBe(
			"March ran hot.",
		);
	});

	test("an even year is steady", () => {
		expect(monthsHeadline("March", [100, 110, 120, 0]).text).toBe(
			"A steady year. March edged ahead.",
		);
	});
});

describe("projectsHeadline", () => {
	test("no project leads when the hours are spread thin", () => {
		const line = projectsHeadline({
			topName: "Project A",
			share: 0.2,
			projectCount: 8,
		});
		expect(line).toEqual({
			text: "Spread across 8 projects.",
			mark: "8 projects",
		});
	});
});
