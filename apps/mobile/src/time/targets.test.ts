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
	workSeconds: 14 * H,
	timeOffSeconds: 0,
	totalSeconds: 14 * H,
	totalSoFarSeconds: 14 * H,
	status: "slightly_behind",
	...fields,
});

describe("the targets", () => {
	test("say how far the person is from today's target", () => {
		expect(targetGap(period({}))).toEqual({
			ahead: false,
			text: "2:00 short of today's 16:00",
		});
		expect(targetGap(period({ totalSoFarSeconds: 17.5 * H }))?.text).toBe(
			"1:30 ahead of today's 16:00",
		);
		expect(targetGap(period({ targetSoFarSeconds: null }))).toBeNull();
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
