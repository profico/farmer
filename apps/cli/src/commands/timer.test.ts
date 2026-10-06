import { describe, expect, test } from "bun:test";

import type { ApiTimeEntry } from "@farmer/core/api";

import { stoppedMeasured, stoppedNote, whyNotContinued } from "./timer";

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

describe("stoppedMeasured", () => {
	const continued = {
		snappedSeconds: 3 * HOUR + 30 * 60,
		entry: { id: "e", date: "2026-09-14", durationSeconds: 3 * HOUR },
	};

	test("sends the measured part when nothing was typed", () => {
		expect(stoppedMeasured(continued, undefined)).toBe(30 * 60);
	});

	test("never sends a negative measured part", () => {
		expect(
			stoppedMeasured(
				{ snappedSeconds: HOUR, entry: { ...continued.entry } },
				undefined,
			),
		).toBe(0);
	});

	// The reviewer's case: the entry held 3:00, `farmer continue` ran 0:30,
	// and `--duration 0:30` meant the new part. It must not become the total.
	test("sends a typed duration as the part to add to a continued entry", () => {
		expect(stoppedMeasured(continued, "0:30")).toBe(30 * 60);
	});

	test("a typed duration on a new entry is the entry", () => {
		expect(stoppedMeasured({ snappedSeconds: HOUR, entry: null }, "0:30")).toBe(
			30 * 60,
		);
		expect(
			stoppedMeasured({ snappedSeconds: HOUR, entry: null }, undefined),
		).toBe(HOUR);
	});

	test("refuses a sum past a day", () => {
		expect(() =>
			stoppedMeasured(
				{
					...continued,
					entry: { ...continued.entry, durationSeconds: 23 * HOUR },
				},
				"2h",
			),
		).toThrow("more than 24 hours");
	});
});

describe("stoppedNote", () => {
	const read = "Old note";

	test("sends -m", () => {
		expect(stoppedNote({ message: "From -m", answer: undefined, read })).toBe(
			"From -m",
		);
	});

	test("sends nothing for an unchanged answer", () => {
		expect(
			stoppedNote({ message: undefined, answer: " Old note ", read }),
		).toBeUndefined();
	});

	test("sends a changed answer", () => {
		expect(
			stoppedNote({ message: undefined, answer: " New note ", read }),
		).toBe("New note");
	});

	test("sends an emptied answer, which clears the note", () => {
		expect(stoppedNote({ message: undefined, answer: "", read })).toBe("");
	});

	test("sends a typed note when the timer had none", () => {
		expect(stoppedNote({ message: undefined, answer: "Typed", read: "" })).toBe(
			"Typed",
		);
	});

	test("sends nothing from a script without -m", () => {
		expect(
			stoppedNote({ message: undefined, answer: undefined, read }),
		).toBeUndefined();
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
