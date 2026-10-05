import { describe, expect, test } from "bun:test";

/// <reference types="bun-types" />
import type { UnfiledEntry } from "@farmer/api-client";

import {
	groupUnfiled,
	restoreBody,
	selectionOf,
	toggleIds,
	unfiledHeadline,
} from "./unfiled";

let next = 0;
const unfiled = (fields: Partial<UnfiledEntry> = {}): UnfiledEntry => {
	next += 1;
	return {
		id: `u${next}`,
		date: "2026-10-05",
		durationSeconds: 1800,
		description: "Stand-up",
		task: { id: "meeting", name: "Meeting" },
		meetingUrl: null,
		...fields,
	};
};

describe("the groups of unfiled time", () => {
	test("the same work is one group, the biggest first", () => {
		const groups = groupUnfiled([
			unfiled({ description: "Review", durationSeconds: 3600 }),
			unfiled({ date: "2026-10-05" }),
			unfiled({ date: "2026-10-06", description: "stand-up " }),
			unfiled({ date: "2026-10-07", durationSeconds: 900 }),
		]);
		expect(groups.map((group) => [group.title, group.entries.length])).toEqual([
			["Stand-up", 2],
			["Review", 1],
			["Stand-up", 1],
		]);
		expect(groups[0]?.seconds).toBe(3600);
	});

	test("an entry with no note takes the task as its title", () => {
		expect(groupUnfiled([unfiled({ description: "" })])[0]?.title).toBe(
			"Meeting",
		);
	});
});

describe("the selection", () => {
	test("a group is selected all at once, and cleared when it is full", () => {
		const some = new Set(["a"]);
		expect(selectionOf(some, ["a", "b"])).toBe("some");
		const all = toggleIds(some, ["a", "b"]);
		expect(selectionOf(all, ["a", "b"])).toBe("all");
		expect(selectionOf(toggleIds(all, ["a", "b"]), ["a", "b"])).toBe("none");
	});
});

describe("undo", () => {
	test("puts the entry back on its day, with its task, time and link", () => {
		expect(
			restoreBody(
				unfiled({ meetingUrl: "https://meet.example/x", description: "" }),
			),
		).toEqual({
			date: "2026-10-05",
			taskId: "meeting",
			description: undefined,
			durationSeconds: 1800,
			meetingUrl: "https://meet.example/x",
		});
	});

	test("the headline counts the entries", () => {
		expect(unfiledHeadline(1, "this week")).toBe(
			"1 entry this week needs a project.",
		);
		expect(unfiledHeadline(4, "this month")).toBe(
			"4 entries this month need a project.",
		);
	});
});
