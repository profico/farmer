import { describe, expect, test } from "bun:test";

/// <reference types="bun-types" />
import type { Period } from "@farmer/api-client";

import { targetGap, targetProgress, targetStatus } from "./targets";

const H = 3600;
const period = (fields: Partial<Period>): Period => ({
	from: "2026-10-05",
	to: "2026-10-11",
	workingDays: 5,
	workingDaysElapsed: 2,
	targetSeconds: 40 * H,
	targetSoFarSeconds: 16 * H,
	workingDaysThroughToday: 3,
	targetThroughTodaySeconds: 24 * H,
	workSeconds: 14 * H,
	timeOffSeconds: 0,
	totalSeconds: 14 * H,
	totalSoFarSeconds: 14 * H,
	status: "slightly_behind",
	...fields,
});

describe("the targets", () => {
	test("say how far the person is from the goal through today", () => {
		expect(targetGap(period({}))).toEqual({
			ahead: false,
			tone: "warning",
			text: "10:00 short of the 24:00 due by the end of today",
		});
		expect(targetGap(period({ totalSoFarSeconds: 25.5 * H }))).toEqual({
			ahead: true,
			tone: "good",
			text: "1:30 ahead of the 24:00 due by the end of today",
		});
		expect(targetGap(period({ status: "behind" }))?.tone).toBe("bad");
		expect(targetGap(period({ status: "on_track" }))?.tone).toBe("neutral");
		expect(targetGap(period({ targetSoFarSeconds: null }))).toBeNull();
	});

	test("count today's own working day on a Monday", () => {
		const monday = period({
			workingDaysElapsed: 0,
			workingDaysThroughToday: 1,
			targetSoFarSeconds: 0,
			targetThroughTodaySeconds: 8 * H,
			workSeconds: 0,
			totalSeconds: 0,
			totalSoFarSeconds: 0,
			status: null,
		});
		expect(targetGap(monday)?.text).toBe(
			"8:00 short of the 8:00 due by the end of today",
		);
	});

	test("read the status in the report's words", () => {
		expect(targetStatus("on_track")).toEqual({
			label: "On track",
			tone: "good",
		});
		expect(targetStatus(null)).toBeNull();
		expect(targetProgress(period({}))).toBe(14 / 40);
		expect(targetProgress(period({ targetSeconds: null }))).toBeNull();
	});
});
