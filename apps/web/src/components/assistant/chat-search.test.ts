import { describe, expect, test } from "bun:test";

import { matchParts } from "./chat-search.tsx";

describe("matchParts", () => {
	test("marks every match, ignoring case", () => {
		expect(matchParts("Budget for the budget", "budget")).toEqual([
			{ text: "Budget", match: true },
			{ text: " for the ", match: false },
			{ text: "budget", match: true },
		]);
	});

	test("returns the whole text when nothing matches", () => {
		expect(matchParts("hello", "zz")).toEqual([
			{ text: "hello", match: false },
		]);
	});
});
