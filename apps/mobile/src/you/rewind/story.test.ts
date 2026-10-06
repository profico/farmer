import { describe, expect, test } from "bun:test";

/// <reference types="bun-types" />
import type { Rewind } from "@farmer/api-client";

import {
	defaultRewindYear,
	featuredRewindYear,
	isRewindOpen,
	personaFor,
	shareText,
	slidesOf,
} from "./story";

const year: Rewind = {
	year: 2025,
	asOf: "2025-12-31",
	complete: true,
	workedSeconds: 1600 * 3600,
	projectedWorkedSeconds: null,
	previousYearWorkedSeconds: null,
	firstDay: "2025-01-02",
	daysWorked: 200,
	longestStreak: { days: 12, from: "2025-03-03", to: "2025-03-18" },
	busiestDay: { date: "2025-06-04", seconds: 11 * 3600 },
	months: Array.from({ length: 12 }, (_, i) => ({
		month: i + 1,
		seconds: (i === 5 ? 180 : 130) * 3600,
		projectedSeconds: 0,
	})),
	weekdays: [0, 10, 20, 30, 20, 10, 0],
	weekendDaysWorked: 0,
	overtimeSeconds: 0,
	projects: [
		{ id: "p", name: "Atlas", icon: null, clientName: "Acme", seconds: 900 },
	],
	projectCount: 1,
	clientCount: 1,
	tasks: [],
	groups: [{ group: "engineering", seconds: 1600 * 3600 }],
	meetingSeconds: 0,
	codeReviewSeconds: 0,
	timeOff: { vacationDays: 0, sickDays: 0, otherDays: 0, aheadDays: 0 },
	commits: 0,
	pullRequests: { opened: 0, merged: 0, reviewed: 0 },
	words: [],
};

describe("when a Rewind opens", () => {
	test("the current year opens on 1 December", () => {
		expect(isRewindOpen(2026, "2026-11-30")).toBe(false);
		expect(isRewindOpen(2026, "2026-12-01")).toBe(true);
		expect(isRewindOpen(2025, "2026-06-01")).toBe(true);
	});

	test("the More row shows in December and January only", () => {
		expect(featuredRewindYear("2026-12-01")).toBe(2026);
		expect(featuredRewindYear("2027-01-31")).toBe(2026);
		expect(featuredRewindYear("2027-02-01")).toBeNull();
		expect(featuredRewindYear("2026-11-30")).toBeNull();
		expect(featuredRewindYear("2026-10-06")).toBeNull();
		// Before `whoami` arrives, there is no date and no row.
		expect(featuredRewindYear("")).toBeNull();
	});

	test("the default year follows the season", () => {
		expect(defaultRewindYear("2026-12-05")).toBe(2026);
		expect(defaultRewindYear("2027-01-10")).toBe(2026);
		expect(defaultRewindYear("2026-10-06")).toBe(2025);
	});
});

describe("the slides", () => {
	test("a slide with nothing to say is left out", () => {
		expect(slidesOf(year)).toEqual([
			"intro",
			"hours",
			"days",
			"months",
			"bigDay",
			"projects",
			"persona",
			"summary",
		]);
	});

	test("an empty year has only the intro and a message", () => {
		expect(slidesOf({ ...year, workedSeconds: 0 })).toEqual(["intro", "empty"]);
	});

	test("meetings over a third of the year make the Connector", () => {
		expect(personaFor(year).title).toBe("The Builder");
		expect(personaFor({ ...year, meetingSeconds: 600 * 3600 }).title).toBe(
			"The Connector",
		);
	});

	test("the shared text holds the summary", () => {
		expect(shareText(year)).toContain("Biggest month: June");
		expect(shareText(year)).toContain("Hours: 1,600");
	});
});
