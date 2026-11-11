import { expect, test } from "bun:test";

import { chooseSuggestions, type SuggestionFacts } from "./suggestions.ts";

const quiet: SuggestionFacts = {
	daySeconds: 8 * 3600,
	todaySeconds: 8 * 3600,
	yesterdaySeconds: 8 * 3600,
	todayIsWorkingDay: true,
	yesterdayIsWorkingDay: true,
	unfiledCount: 0,
	calendarConnected: false,
};

test("a full day with nothing to file gives only general questions", () => {
	const result = chooseSuggestions(quiet);
	expect(result).toHaveLength(2);
	expect(result.join(" ")).not.toMatch(/March|January|today/);
});

test("a short day and unfiled entries come first", () => {
	const result = chooseSuggestions({
		...quiet,
		todaySeconds: 3600,
		unfiledCount: 4,
	});
	expect(result).toEqual([
		"Help me log the rest of today",
		"File my 4 unfiled entries",
		"How many hours did I log last week?",
	]);
});

test("a short day off work is not offered", () => {
	const result = chooseSuggestions({
		...quiet,
		todaySeconds: 0,
		todayIsWorkingDay: false,
	});
	expect(result).not.toContain("Help me log the rest of today");
});

test("yesterday needs the calendar", () => {
	const short = { ...quiet, yesterdaySeconds: 0 };
	expect(chooseSuggestions(short)).not.toContain(
		"Fill yesterday from my calendar",
	);
	expect(chooseSuggestions({ ...short, calendarConnected: true })).toContain(
		"Fill yesterday from my calendar",
	);
});

test("no target means no hours suggestion, and data not loaded is quiet", () => {
	expect(
		chooseSuggestions({ ...quiet, daySeconds: null, todaySeconds: 0 }),
	).toHaveLength(2);
	expect(chooseSuggestions({ ...quiet, todaySeconds: null })).toHaveLength(2);
});

test("a general question always stays and the list has three at most", () => {
	const result = chooseSuggestions({
		...quiet,
		todaySeconds: 0,
		yesterdaySeconds: 0,
		unfiledCount: 1,
		calendarConnected: true,
	});
	expect(result).toHaveLength(3);
	expect(result).toContain("How many hours did I log last week?");
	expect(result).toContain("File my unfiled entry");
});
