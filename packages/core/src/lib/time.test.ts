import { describe, expect, test } from "bun:test";
import { countWorkingDays } from "./time";

const MON_FRI = new Set([1, 2, 3, 4, 5]);

describe("countWorkingDays", () => {
	test("counts a full Mon-Fri work week as 5", () => {
		// 2026-07-13 is a Monday, 2026-07-17 a Friday.
		expect(countWorkingDays("2026-07-13", "2026-07-17", MON_FRI, new Set())).toBe(
			5,
		);
	});

	test("excludes weekends", () => {
		// Mon 2026-07-13 .. Sun 2026-07-19 = 7 calendar days, 5 working.
		expect(countWorkingDays("2026-07-13", "2026-07-19", MON_FRI, new Set())).toBe(
			5,
		);
	});

	test("excludes holidays that fall on a working day", () => {
		const holidays = new Set(["2026-07-15"]); // a Wednesday
		expect(
			countWorkingDays("2026-07-13", "2026-07-17", MON_FRI, holidays),
		).toBe(4);
	});

	test("a holiday on a weekend does not double-subtract", () => {
		const holidays = new Set(["2026-07-18"]); // a Saturday, already excluded
		expect(
			countWorkingDays("2026-07-13", "2026-07-19", MON_FRI, holidays),
		).toBe(5);
	});

	test("single working day is 1", () => {
		expect(countWorkingDays("2026-07-15", "2026-07-15", MON_FRI, new Set())).toBe(
			1,
		);
	});

	test("respects a custom enabled-weekday set (Tue-Thu)", () => {
		const tueThu = new Set([2, 3, 4]);
		expect(countWorkingDays("2026-07-13", "2026-07-17", tueThu, new Set())).toBe(
			3,
		);
	});
});
