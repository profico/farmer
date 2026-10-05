// The sentence under a tile reads the goal through today (issue #105): on the
// first working day of a week the goal is one day, not 0. The color of a short
// gap follows the verdict, which does not count today.

import { describe, expect, test } from "bun:test";

import type { PeriodTarget } from "@farmer/core/services";
import { renderToStaticMarkup } from "react-dom/server";

import { TargetGap, targetGapTone } from "./targets.tsx";

const H = 3600;

const period = (over: Partial<PeriodTarget>): PeriodTarget => ({
	from: "2026-04-13",
	to: "2026-04-19",
	workingDays: 5,
	workingDaysElapsed: 0,
	workingDaysThroughToday: 1,
	targetSeconds: 40 * H,
	targetSoFarSeconds: 0,
	targetThroughTodaySeconds: 8 * H,
	workSeconds: 0,
	timeOffSeconds: 0,
	totalSeconds: 0,
	totalSoFarSeconds: 0,
	status: "on_track",
	...over,
});

const textOf = (value: PeriodTarget) =>
	renderToStaticMarkup(<TargetGap period={value} />)
		.replace(/<[^>]*>/g, "")
		.replace(/\s+/g, " ")
		.trim();

describe("the target gap on a Monday", () => {
	test("the goal is a day's worth, not 0", () => {
		const text = textOf(period({ totalSoFarSeconds: 3.5 * H }));
		expect(text).toBe("4,50 short of the 8,00 due by the end of today");
	});

	test("an empty Monday is short by the whole day", () => {
		expect(textOf(period({}))).toBe(
			"8,00 short of the 8,00 due by the end of today",
		);
	});

	test("on a Thursday the goal is four days and never reads today's", () => {
		const text = textOf(
			period({
				workingDaysElapsed: 3,
				workingDaysThroughToday: 4,
				targetSoFarSeconds: 24 * H,
				targetThroughTodaySeconds: 32 * H,
				totalSoFarSeconds: 27 * H,
				status: "behind",
			}),
		);
		expect(text).toBe("5,00 short of the 32,00 due by the end of today");
		expect(text).not.toContain("today's");
	});

	test("hours above the goal are ahead", () => {
		expect(textOf(period({ totalSoFarSeconds: 9 * H }))).toBe(
			"1,00 ahead of the 8,00 due by the end of today",
		);
	});

	test("no target still says so", () => {
		const text = textOf(
			period({ targetSoFarSeconds: null, targetThroughTodaySeconds: null }),
		);
		expect(text).toBe("No target");
	});

	test("an older reading without the goal falls back to the verdict target", () => {
		const text = textOf(
			period({
				targetThroughTodaySeconds: null,
				targetSoFarSeconds: 24 * H,
				totalSoFarSeconds: 25 * H,
			}),
		);
		expect(text).toContain("ahead");
	});
});

describe("the color of the gap", () => {
	test("short by today's hours only is not red while the verdict is on track", () => {
		expect(targetGapTone(period({ status: "on_track" }), -8 * H)).toBe(
			"text-foreground",
		);
	});

	test("a slightly behind verdict is a warning", () => {
		expect(targetGapTone(period({ status: "slightly_behind" }), -1 * H)).toBe(
			"text-warn",
		);
	});

	test("a behind verdict is red", () => {
		expect(targetGapTone(period({ status: "behind" }), -9 * H)).toBe(
			"text-bad",
		);
	});

	test("ahead is green whatever the verdict", () => {
		expect(targetGapTone(period({ status: "on_track" }), 0)).toBe("text-ok");
	});
});
