import { describe, expect, test } from "bun:test";

import { plainText } from "./plain-text";

describe("plainText", () => {
	test("drops closed and unclosed fences", () => {
		expect(
			plainText('A\n```farmer-chart\n{"value":6}\n```\nB\n```farmer-next\nQ?'),
		).toBe("A B");
	});

	test("turns a date directive into the date", () => {
		expect(plainText("Busiest was [[2026-11-11]].")).toBe(
			"Busiest was 2026-11-11.",
		);
	});

	test("strips emphasis, code ticks, links and headings", () => {
		expect(
			plainText("## Title\n**bold** *it* `code` [text](https://x.y/z)"),
		).toBe("Title bold it code text");
	});

	test("turns table pipes into spaces", () => {
		expect(plainText("| a | b |")).toBe("a b");
	});

	test("keeps an underscore inside a word", () => {
		expect(plainText("_it_ snake_case")).toBe("it snake_case");
	});
});
