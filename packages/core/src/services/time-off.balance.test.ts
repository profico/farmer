import { describe, expect, test } from "bun:test";
import { computeVacationRemaining } from "./time-off.service";

describe("computeVacationRemaining", () => {
	test("no carryover: remaining is allowance minus consumed", () => {
		const r = computeVacationRemaining({
			allowanceDays: 20,
			carryoverDays: 0,
			consumed: 5,
			expired: false,
		});
		expect(r.remainingDays).toBe(15);
		expect(r.baseConsumed).toBe(5);
	});

	test("carryover consumed first: base allowance untouched until carryover spent", () => {
		const r = computeVacationRemaining({
			allowanceDays: 20,
			carryoverDays: 5,
			consumed: 3,
			expired: false,
		});
		// 3 of the 5 carried days used; base 20 intact, 2 carried remain.
		expect(r.carryoverConsumed).toBe(3);
		expect(r.baseConsumed).toBe(0);
		expect(r.remainingDays).toBe(22);
	});

	test("consuming more than carryover spills into base", () => {
		const r = computeVacationRemaining({
			allowanceDays: 20,
			carryoverDays: 5,
			consumed: 8,
			expired: false,
		});
		expect(r.carryoverConsumed).toBe(5);
		expect(r.baseConsumed).toBe(3);
		expect(r.remainingDays).toBe(17); // 20 - 3 + (5 - 5)
	});

	test("expired carryover: unused carryover forfeited, consumed carryover stays attributed", () => {
		const r = computeVacationRemaining({
			allowanceDays: 20,
			carryoverDays: 5,
			consumed: 3,
			expired: true,
		});
		// 3 carried days already used (don't eat base); remaining 2 carried forfeited.
		expect(r.baseConsumed).toBe(0);
		expect(r.remainingDays).toBe(20);
	});

	test("expired carryover with base spend", () => {
		const r = computeVacationRemaining({
			allowanceDays: 20,
			carryoverDays: 5,
			consumed: 8,
			expired: true,
		});
		expect(r.baseConsumed).toBe(3);
		expect(r.remainingDays).toBe(17);
	});
});
