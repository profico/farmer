/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { daySeconds, secondsByDay, sumSeconds } from "./seconds";

const entries = [
	{ date: "2026-10-05", durationSeconds: 3600 },
	{ date: "2026-10-05", durationSeconds: 1800 },
	{ date: "2026-10-06", durationSeconds: 7200 },
];

describe("seconds", () => {
	test("a sum of nothing is zero", () => {
		expect(sumSeconds([])).toBe(0);
	});

	test("a sum adds every entry", () => {
		expect(sumSeconds(entries)).toBe(12_600);
	});

	test("a day counts its own entries only", () => {
		expect(daySeconds(entries, "2026-10-05")).toBe(5400);
		expect(daySeconds(entries, "2026-10-07")).toBe(0);
	});

	test("the totals by day leave out a day with no entry", () => {
		const totals = secondsByDay(entries);
		expect(totals.get("2026-10-05")).toBe(5400);
		expect(totals.get("2026-10-06")).toBe(7200);
		expect(totals.size).toBe(2);
	});
});
