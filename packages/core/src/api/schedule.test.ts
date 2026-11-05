// The schedule projections, for the reason `time-entries.test.ts` gives. A
// recurring block row carries the whole task and project rows through its
// joins, and only their names may go out.

import { describe, expect, test } from "bun:test";

import { toApiRecurringBlock, toApiWorkingHoursDay } from "./schedule";

describe("toApiWorkingHoursDay", () => {
	test("keeps exactly the fields it names", () => {
		const row = {
			id: "w-1",
			organizationId: "org-1",
			userId: "u-1",
			dayOfWeek: 1,
			enabled: true,
			startTime: "09:00",
			endTime: "17:00",
			updatedAt: new Date("2026-09-14T08:00:00Z"),
		};
		expect(toApiWorkingHoursDay(row)).toStrictEqual({
			dayOfWeek: 1,
			enabled: true,
			startTime: "09:00",
			endTime: "17:00",
		});
	});
});

describe("toApiRecurringBlock", () => {
	const row = {
		id: "r-1",
		organizationId: "org-1",
		userId: "u-1",
		taskId: "t-1",
		projectId: "p-1",
		description: "Standup",
		daysOfWeek: [1, 2, 3, 4, 5],
		durationSeconds: 900,
		effectiveFrom: null,
		effectiveUntil: "2026-12-31",
		active: true,
		activeSince: new Date("2026-09-14T08:00:00Z"),
		task: { id: "t-1", name: "Meeting", organizationId: "org-1" },
		project: {
			id: "p-1",
			name: "Apollo",
			code: null,
			hourlyPrice: "85.00",
		},
	};

	test("keeps exactly the fields it names", () => {
		expect(toApiRecurringBlock(row)).toStrictEqual({
			id: "r-1",
			task: { id: "t-1", name: "Meeting" },
			project: { id: "p-1", name: "Apollo", code: null },
			description: "Standup",
			daysOfWeek: [1, 2, 3, 4, 5],
			durationSeconds: 900,
			effectiveFrom: null,
			effectiveUntil: "2026-12-31",
			active: true,
		});
	});

	test("a block with no project answers null", () => {
		expect(toApiRecurringBlock({ ...row, project: null }).project).toBeNull();
	});
});
