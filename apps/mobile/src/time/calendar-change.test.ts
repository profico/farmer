/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	calendarChangeSentences,
	calendarDifference,
	meetingSeconds,
} from "./calendar-change";

const change = (
	from: { date?: string; durationSeconds?: number; description?: string },
	calendar: { date: string; durationSeconds: number } | null = null,
) => ({ changedAt: "2026-10-06T08:00:00.000Z", from, calendar });

describe("the calendar notice", () => {
	test("says one sentence for each field the sync changed", () => {
		expect(
			calendarChangeSentences(
				change({
					date: "2026-10-05",
					durationSeconds: 1800,
					description: "Stand-up",
				}),
				(day) => day,
			),
		).toEqual([
			"Moved from 2026-10-05",
			"Was 0:30 long",
			'Was called "Stand-up"',
		]);
		expect(calendarChangeSentences(change({ description: "" }))).toEqual([]);
	});

	test("offers the calendar's values only when they differ", () => {
		const entry = { date: "2026-10-06", durationSeconds: 3600 };
		expect(calendarDifference(entry, change({}))).toBeNull();
		expect(
			calendarDifference(
				entry,
				change({}, { date: "2026-10-06", durationSeconds: 3600 }),
			),
		).toBeNull();
		expect(
			calendarDifference(
				entry,
				change({}, { date: "2026-10-06", durationSeconds: 1800 }),
			),
		).toEqual({ date: "2026-10-06", durationSeconds: 1800 });
	});
});

describe("a picked meeting", () => {
	test("gives its length on the quarter-hour grid", () => {
		const event = (start: string, end: string) => ({
			id: "e1",
			title: "Stand-up",
			start,
			end,
			meetingUrl: null,
			htmlLink: null,
		});
		expect(
			meetingSeconds(event("2026-10-06T09:00:00Z", "2026-10-06T09:25:00Z")),
		).toBe(1800);
		expect(
			meetingSeconds(event("2026-10-06T09:00:00Z", "2026-10-06T09:05:00Z")),
		).toBe(900);
	});
});
