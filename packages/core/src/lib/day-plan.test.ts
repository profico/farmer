import { describe, expect, test } from "bun:test";

import { splitProportionally, summarizeCommitMessages } from "./day-plan";

describe("splitProportionally", () => {
	test("splits evenly across equal weights", () => {
		expect(splitProportionally(4 * 3600, [1, 1])).toEqual([7200, 7200]);
	});

	test("shares sum to the total and respect proportions", () => {
		const shares = splitProportionally(6 * 3600, [3, 1]);
		expect(shares).toEqual([16200, 5400]); // 4h30m / 1h30m
		expect(shares.reduce((a, b) => a + b, 0)).toBe(6 * 3600);
	});

	test("every non-zero weight gets at least one slot", () => {
		const shares = splitProportionally(3600, [10, 1, 1]);

		for (const share of shares) expect(share).toBeGreaterThanOrEqual(900);
		expect(shares.reduce((a, b) => a + b, 0)).toBe(3600);
	});

	test("zero total or zero weights yield zero shares", () => {
		expect(splitProportionally(0, [1, 2])).toEqual([0, 0]);
		expect(splitProportionally(3600, [0, 0])).toEqual([0, 0]);
	});

	test("a weight of zero gets no share", () => {
		expect(splitProportionally(4 * 3600, [1, 0, 1])).toEqual([7200, 0, 7200]);
	});

	// The caller's total is a remaining-budget for the day, so rounding UP would
	// push the day over its working hours.
	test("never allocates more than the total", () => {
		for (const total of [3700, 4100, 4499, 4500, 5000, 12345]) {
			const shares = splitProportionally(total, [3, 2, 1]);
			expect(shares.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(total);
		}
	});

	test("non-slot-aligned totals floor to the 15-minute grid", () => {
		expect(splitProportionally(3700, [1])).toEqual([3600]);
		expect(splitProportionally(4499, [1])).toEqual([3600]);
	});
});

describe("summarizeCommitMessages", () => {
	test("joins the first line of every message", () => {
		expect(
			summarizeCommitMessages([
				"fix login\n\ndetails",
				"add page",
				"bump",
				"docs",
			]),
		).toBe("fix login; add page; bump; docs");
	});

	test("drops empty messages", () => {
		expect(summarizeCommitMessages(["", "one\nbody"])).toBe("one");
	});

	test("stops at the description ceiling on a whole subject", () => {
		const subject = "x".repeat(99);
		const summary = summarizeCommitMessages(Array(200).fill(subject));
		expect(summary.length).toBeLessThanOrEqual(10_000);
		expect(summary.split("; ").every((s) => s === subject)).toBe(true);
	});

	test("trims trailing whitespace on subjects", () => {
		expect(summarizeCommitMessages(["fix login   \nbody"])).toBe("fix login");
	});

	test("no messages yields an empty summary", () => {
		expect(summarizeCommitMessages([])).toBe("");
	});
});
