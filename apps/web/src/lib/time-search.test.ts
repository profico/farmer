import { describe, expect, test } from "bun:test";

import { dateSearch, monthSearch, weekSearch } from "./time-search.ts";

describe("dateSearch", () => {
	test("leaves out the date when the day is today", () => {
		expect(dateSearch("2026-10-05", "2026-10-05")).toEqual({});
	});

	test("keeps a past day", () => {
		expect(dateSearch("2026-09-15", "2026-10-05")).toEqual({
			date: "2026-09-15",
		});
	});

	test("keeps a future day", () => {
		expect(dateSearch("2026-10-06", "2026-10-05")).toEqual({
			date: "2026-10-06",
		});
	});
});

describe("weekSearch", () => {
	test("leaves out the week start for the current week", () => {
		expect(weekSearch("2026-10-05", "2026-10-05")).toEqual({});
	});

	test("keeps another week", () => {
		expect(weekSearch("2026-09-28", "2026-10-05")).toEqual({
			weekStart: "2026-09-28",
		});
		expect(weekSearch("2026-10-12", "2026-10-05")).toEqual({
			weekStart: "2026-10-12",
		});
	});
});

describe("monthSearch", () => {
	test("leaves out the month for the month of today", () => {
		expect(monthSearch("2026-10", "2026-10-31")).toEqual({});
	});

	test("keeps another month, also across a year end", () => {
		expect(monthSearch("2026-09", "2026-10-05")).toEqual({ month: "2026-09" });
		expect(monthSearch("2027-01", "2026-12-31")).toEqual({ month: "2027-01" });
	});
});
