// The period projection feeds `farmer status` and the scripts on top of its
// `--json`. The goal through today is a field that an installed binary reads,
// so a refactor of the projection must not drop it.

import { describe, expect, test } from "bun:test";

import type { PeriodTarget } from "../services/compliance.service";
import { toApiPeriod } from "./catalogue";

/** The first working day of a week: the verdict has nothing due, and the goal
 *  through today is one day. */
const monday: PeriodTarget = {
	from: "2026-04-13",
	to: "2026-04-19",
	workingDays: 5,
	workingDaysElapsed: 0,
	workingDaysThroughToday: 1,
	targetSeconds: 40 * 3600,
	targetSoFarSeconds: 0,
	targetThroughTodaySeconds: 8 * 3600,
	workSeconds: 0,
	timeOffSeconds: 0,
	totalSeconds: 0,
	totalSoFarSeconds: 0,
	status: "on_track",
};

describe("toApiPeriod", () => {
	test("passes the goal through today next to the target so far", () => {
		const period = toApiPeriod(monday);
		expect(period.targetSoFarSeconds).toBe(0);
		expect(period.targetThroughTodaySeconds).toBe(8 * 3600);
		expect(period.workingDaysElapsed).toBe(0);
		expect(period.workingDaysThroughToday).toBe(1);
	});
});
