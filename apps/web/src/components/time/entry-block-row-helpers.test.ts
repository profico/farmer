/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	calendarMarkTitle,
	durationKeyAction,
	errorMessage,
	hasCount,
	isWorkEntry,
	linkedCountTitle,
	NOTE_LIMIT,
	noteChanged,
	noteView,
	readDurationEdit,
} from "./entry-block-row-helpers.ts";
import type { EntryBlockRowEntry } from "./entry-block-row.tsx";

const workEntry = (
	over: { isAbsence?: boolean; fillsDay?: boolean } = {},
): Pick<EntryBlockRowEntry, "fillsDay"> & {
	task: Pick<EntryBlockRowEntry["task"], "isAbsence">;
} => ({
	fillsDay: over.fillsDay ?? false,
	task: { isAbsence: over.isAbsence ?? false },
});

describe("noteView", () => {
	test("a short note is shown whole", () => {
		expect(noteView("short", false)).toEqual({
			isLong: false,
			shownNote: "short",
		});
	});

	test("a note at the limit is not long", () => {
		const note = "a".repeat(NOTE_LIMIT);
		expect(noteView(note, false).isLong).toBe(false);
	});

	test("a long note is cut and trimmed until expanded", () => {
		const note = `${"a".repeat(NOTE_LIMIT - 1)} ${"b".repeat(50)}`;
		const view = noteView(note, false);
		expect(view.isLong).toBe(true);
		expect(view.shownNote).toBe(`${"a".repeat(NOTE_LIMIT - 1)}…`);
		expect(noteView(note, true).shownNote).toBe(note);
	});
});

describe("noteChanged", () => {
	test("trailing space is not a change", () => {
		expect(noteChanged("hello  ", "hello")).toBe(false);
	});

	test("an empty draft against a null note is not a change", () => {
		expect(noteChanged("", null)).toBe(false);
	});

	test("a different text is a change", () => {
		expect(noteChanged("new", "old")).toBe(true);
		expect(noteChanged("new", null)).toBe(true);
	});
});

describe("errorMessage", () => {
	test("uses the message, else the fallback", () => {
		expect(errorMessage({ message: "boom" }, "fallback")).toBe("boom");
		expect(errorMessage({}, "fallback")).toBe("fallback");
	});
});

describe("isWorkEntry", () => {
	test("is false for an absence and for a fill block", () => {
		expect(isWorkEntry(workEntry())).toBe(true);
		expect(isWorkEntry(workEntry({ isAbsence: true }))).toBe(false);
		expect(isWorkEntry(workEntry({ fillsDay: true }))).toBe(false);
	});
});

describe("hasCount and linkedCountTitle", () => {
	test("a badge shows only for a positive count", () => {
		expect(hasCount(undefined)).toBe(false);
		expect(hasCount(0)).toBe(false);
		expect(hasCount(2)).toBe(true);
	});

	test("the title is singular for one", () => {
		expect(linkedCountTitle(1, "commit")).toBe("1 linked commit");
		expect(linkedCountTitle(3, "pull request")).toBe("3 linked pull requests");
	});
});

describe("calendarMarkTitle", () => {
	test("names the start when it is known", () => {
		expect(calendarMarkTitle("Tue 15 Sep", "09:30")).toBe(
			"From Google Calendar · Tue 15 Sep at 09:30",
		);
		expect(calendarMarkTitle("Tue 15 Sep", null)).toBe("From Google Calendar");
	});
});

describe("durationKeyAction", () => {
	test("maps Enter and Escape only", () => {
		expect(durationKeyAction("Enter")).toBe("commit");
		expect(durationKeyAction("Escape")).toBe("cancel");
		expect(durationKeyAction("a")).toBeNull();
	});
});

describe("readDurationEdit", () => {
	test("an empty box abandons the edit", () => {
		expect(readDurationEdit("   ", 3600)).toEqual({ kind: "abandon" });
	});

	test("text that is not a length is invalid", () => {
		expect(readDurationEdit("abc", 3600)).toEqual({ kind: "invalid" });
		expect(readDurationEdit("0", 3600)).toEqual({ kind: "invalid" });
	});

	test("a length snaps to the quarter hour and saves", () => {
		expect(readDurationEdit("1h20m", 3600)).toEqual({
			kind: "save",
			snapped: 4500,
		});
	});

	test("a snapped length equal to the stored one is unchanged", () => {
		expect(readDurationEdit("1h20m", 4500)).toEqual({
			kind: "unchanged",
			snapped: 4500,
		});
	});
});
