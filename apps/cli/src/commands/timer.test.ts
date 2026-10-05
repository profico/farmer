import { describe, expect, test } from "bun:test";

import type { ApiTimeEntry } from "@farmer/core/api";

import { stoppedDuration, whyNotContinued } from "./timer";

const HOUR = 3600;

const entry = (over: Partial<ApiTimeEntry> = {}): ApiTimeEntry => ({
	id: "11111111-1111-4111-8111-111111111111",
	date: "2026-09-14",
	durationSeconds: HOUR,
	description: "",
	overtime: false,
	fillsDay: false,
	synced: false,
	commitCount: 0,
	task: { id: "task-1", name: "Development", isAbsence: false },
	project: null,
	calendarChange: null,
	...over,
});

describe("stoppedDuration", () => {
	const continued = {
		snappedSeconds: 3 * HOUR + 30 * 60,
		entry: { id: "e", date: "2026-09-14", durationSeconds: 3 * HOUR },
	};

	test("sends the measured figure when nothing was typed", () => {
		expect(stoppedDuration(continued, undefined)).toBe(3 * HOUR + 30 * 60);
	});

	// The reviewer's case: the entry held 3:00, `farmer continue` ran 0:30,
	// and `--duration 0:30` meant the new part. It must not become the total.
	test("adds a typed duration to what a continued entry held", () => {
		expect(stoppedDuration(continued, "0:30")).toBe(3 * HOUR + 30 * 60);
	});

	test("a typed duration on a new entry is the entry", () => {
		expect(stoppedDuration({ snappedSeconds: HOUR, entry: null }, "0:30")).toBe(
			30 * 60,
		);
	});

	test("refuses a sum past a day", () => {
		expect(() =>
			stoppedDuration(
				{
					...continued,
					entry: { ...continued.entry, durationSeconds: 23 * HOUR },
				},
				"2h",
			),
		).toThrow("more than 24 hours");
	});
});

describe("whyNotContinued", () => {
	test("allows an ordinary entry", () => {
		expect(whyNotContinued(entry())).toBeNull();
	});

	test("refuses a work-time block and time off", () => {
		expect(whyNotContinued(entry({ fillsDay: true }))).toContain(
			"work-time block",
		);
		expect(
			whyNotContinued(
				entry({ task: { id: "t", name: "Vacation", isAbsence: true } }),
			),
		).toContain("time off");
	});
});
