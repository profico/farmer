// The sentence under a week or month tile. It names the target the figures
// are read against, so the wording has to say which days that target counts.

import { describe, expect, test } from "bun:test";

import type { PeriodTarget } from "@farmer/core/services";
import { renderToStaticMarkup } from "react-dom/server";

import { TargetGap } from "./targets.tsx";

const H = 3600;

const period = (over: Partial<PeriodTarget>): PeriodTarget => ({
	from: "2026-04-13",
	to: "2026-04-19",
	workingDays: 5,
	workingDaysElapsed: 3,
	targetSeconds: 40 * H,
	targetSoFarSeconds: 24 * H,
	workSeconds: 0,
	timeOffSeconds: 0,
	totalSeconds: 0,
	totalSoFarSeconds: 0,
	status: "behind",
	...over,
});

/** The visible text of the sentence, without the markup around it. */
const textOf = (value: PeriodTarget) =>
	renderToStaticMarkup(<TargetGap period={value} />)
		.replace(/<[^>]*>/g, "")
		.replace(/\s+/g, " ")
		.trim();

describe("the target gap sentence", () => {
	test("a week behind names the days before today, not today", () => {
		const text = textOf(period({ totalSoFarSeconds: 19 * H }));
		expect(text).toContain("short of");
		expect(text).toContain("due before today");
		expect(text).not.toMatch(/today.{1,6}s/);
	});

	test("a month ahead uses the same words", () => {
		const text = textOf(
			period({
				targetSoFarSeconds: 96 * H,
				targetSeconds: 176 * H,
				totalSoFarSeconds: 101.5 * H,
				status: "on_track",
			}),
		);
		expect(text).toContain("ahead of");
		expect(text).toContain("due before today");
		expect(text).not.toMatch(/today.{1,6}s/);
	});

	test("the first working day has nothing due yet and says so", () => {
		const text = textOf(
			period({ targetSoFarSeconds: 0, workingDaysElapsed: 0 }),
		);
		expect(text).toContain("due before today");
	});

	test("no target stays No target", () => {
		const text = textOf(
			period({ targetSeconds: null, targetSoFarSeconds: null, status: null }),
		);
		expect(text).toBe("No target");
	});
});
