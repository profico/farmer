import { describe, expect, test } from "bun:test";
import {
	middayBreakStartMin,
	minutesToTimeKey,
	placeBlocks,
	splitProportionally,
	summarizeCommitMessages,
	timeKeyToMinutes,
} from "./day-plan";

describe("splitProportionally", () => {
	test("splits evenly across equal weights", () => {
		expect(splitProportionally(4 * 3600, [1, 1])).toEqual([7200, 7200]);
	});

	test("shares sum to the rounded total and respect proportions", () => {
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

	test("non-slot-aligned totals round to the nearest 15 minutes", () => {
		const shares = splitProportionally(3700, [1]);
		expect(shares).toEqual([3600]);
	});
});

describe("placeBlocks", () => {
	test("places sequentially from the day start when nothing is busy", () => {
		expect(placeBlocks([60, 30], [], 9 * 60)).toEqual([
			{ startMin: 540, endMin: 600 },
			{ startMin: 600, endMin: 630 },
		]);
	});

	test("skips over busy intervals it cannot fit before", () => {
		// 10:00-11:00 busy; a 90-minute block does not fit 09:00-10:00.
		const placed = placeBlocks([90], [{ startMin: 600, endMin: 660 }], 540);
		expect(placed).toEqual([{ startMin: 660, endMin: 750 }]);
	});

	test("uses a gap when the block fits before the busy interval", () => {
		const placed = placeBlocks([45], [{ startMin: 600, endMin: 660 }], 540);
		expect(placed).toEqual([{ startMin: 540, endMin: 585 }]);
	});

	test("merges overlapping busy intervals and hops chained gaps", () => {
		const busy = [
			{ startMin: 540, endMin: 600 },
			{ startMin: 590, endMin: 630 },
			{ startMin: 645, endMin: 700 },
		];
		// 30 min does not fit the 630-645 gap, so it lands after 700.
		expect(placeBlocks([30], busy, 540)).toEqual([
			{ startMin: 700, endMin: 730 },
		]);
	});

	test("clips at midnight and drops blocks pushed past it", () => {
		const placed = placeBlocks([120, 60], [], 23 * 60);
		expect(placed).toEqual([{ startMin: 1380, endMin: 1440 }, null]);
	});
});

describe("middayBreakStartMin", () => {
	test("returns the midpoint of a standard 9-5 working window", () => {
		// 09:00 + 4h = 13:00
		expect(middayBreakStartMin(9 * 60, 8 * 3600)).toBe(13 * 60);
	});

	test("snaps the midpoint to the nearest 15-minute slot", () => {
		// 08:00 + 3h45m = 11:45, already slot-aligned
		expect(middayBreakStartMin(8 * 60, 7.5 * 3600)).toBe(11 * 60 + 45);
		// 09:00 + 3h30m = 12:30 for a 7h day
		expect(middayBreakStartMin(9 * 60, 7 * 3600)).toBe(12 * 60 + 30);
	});
});

describe("time key helpers", () => {
	test("round-trips HH:mm", () => {
		expect(timeKeyToMinutes("09:30")).toBe(570);
		expect(minutesToTimeKey(570)).toBe("09:30");
		expect(minutesToTimeKey(1440)).toBe("23:59");
	});
});

describe("summarizeCommitMessages", () => {
	test("joins first lines and counts the overflow", () => {
		expect(
			summarizeCommitMessages(["fix login\n\ndetails", "add page", "bump", "docs"]),
		).toBe("fix login; add page; bump (+1 more)");
	});

	test("drops empty messages", () => {
		expect(summarizeCommitMessages(["", "one\nbody"])).toBe("one");
	});
});
