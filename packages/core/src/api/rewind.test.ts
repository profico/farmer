// The Rewind projection, for the reason `time-entries.test.ts` gives.

import { describe, expect, test } from "bun:test";

import type { Rewind } from "../services/rewind.service";
import { toApiRewind } from "./rewind";

const PROJECT = {
	id: "p-1",
	name: "Apollo",
	icon: null,
	clientName: "Acme",
	seconds: 3600,
};

const REWIND: Rewind = {
	year: 2026,
	asOf: "2026-12-31",
	complete: true,
	workedSeconds: 3600,
	projectedWorkedSeconds: null,
	previousYearWorkedSeconds: null,
	firstDay: "2026-01-05",
	daysWorked: 1,
	longestStreak: { days: 1, from: "2026-01-05", to: "2026-01-05" },
	busiestDay: { date: "2026-01-05", seconds: 3600 },
	months: [{ month: 1, seconds: 3600, projectedSeconds: 0 }],
	weekdays: [0, 3600, 0, 0, 0, 0, 0],
	weekendDaysWorked: 0,
	overtimeSeconds: 0,
	projects: [PROJECT],
	projectCount: 1,
	clientCount: 1,
	tasks: [{ id: "t-1", name: "Development", seconds: 3600 }],
	groups: [{ group: "engineering", seconds: 3600 }],
	meetingSeconds: 0,
	codeReviewSeconds: 0,
	timeOff: { vacationDays: 0, sickDays: 0, otherDays: 0, aheadDays: 0 },
	commits: 2,
	pullRequests: { opened: 1, merged: 1, reviewed: 0 },
	words: [{ word: "migration", count: 2 }],
};

describe("toApiRewind", () => {
	test("copies every field of the year", () => {
		expect(toApiRewind(REWIND)).toStrictEqual(REWIND);
	});

	test("leaves out a field the service adds later", () => {
		const later = {
			...REWIND,
			projects: [{ ...PROJECT, clientId: "c-1" }],
		};
		expect(toApiRewind(later)).toStrictEqual(REWIND);
	});
});
