// The projections in `catalogue.ts`, for the reason `time-entries.test.ts`
// gives: a column added to `client` next month must not become a field that a
// mobile app starts to depend on. The period projection feeds `farmer status`
// and the scripts on top of its `--json`. The goal through today is a field
// that an installed binary reads, so a refactor of the projection must not
// drop it.

import { describe, expect, test } from "bun:test";

import type { PeriodTarget } from "../services/compliance.service";
import { toApiClient, toApiPeriod } from "./catalogue";

describe("toApiClient", () => {
	test("keeps exactly the fields it names", () => {
		const row = {
			id: "c-1",
			name: "Acme",
			isInternal: false,
			organizationId: "org-1",
			archivedAt: null,
			createdAt: new Date("2026-09-14T08:00:00Z"),
		};
		expect(toApiClient(row)).toStrictEqual({
			id: "c-1",
			name: "Acme",
			isInternal: false,
			archivedAt: null,
		});
	});

	test("sends the archive date as ISO 8601", () => {
		const row = {
			id: "c-2",
			name: "Gone",
			isInternal: false,
			archivedAt: new Date("2026-09-20T10:00:00Z"),
		};
		expect(toApiClient(row).archivedAt).toBe("2026-09-20T10:00:00.000Z");
	});
});

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
