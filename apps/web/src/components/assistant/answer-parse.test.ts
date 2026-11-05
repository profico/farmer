/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { type Block, parseBlocks, safeHref } from "./answer-parse.ts";

const chartJson = JSON.stringify({
	type: "bar",
	title: "Hours",
	data: [
		{ label: "A", value: 3 },
		{ label: "B", value: 5 },
	],
});

const at = (blocks: Block[], index: number): Block => {
	const block = blocks[index];
	if (!block) throw new Error(`no block at ${index}`);
	return block;
};

/** Parse in a child process with a deadline. A reader that fails to advance
 *  spins in a synchronous loop, which a test timeout cannot interrupt: the
 *  child is killed instead, and the test fails in two seconds, not never. */
const parseInChild = (source: string, streaming: boolean): string[] => {
	const module = new URL("./answer-parse.ts", import.meta.url).href;
	const child = Bun.spawnSync({
		cmd: [
			process.execPath,
			"-e",
			`import { parseBlocks } from ${JSON.stringify(module)};
console.log(JSON.stringify(parseBlocks(${JSON.stringify(source)}, ${streaming}).map((b) => b.kind)));`,
		],
		timeout: 2000,
	});
	if (child.exitCode !== 0) {
		throw new Error("parseBlocks did not return: it may loop forever");
	}
	return JSON.parse(child.stdout.toString());
};

const kinds = (blocks: Block[]) => blocks.map((block) => block.kind);

describe("parseBlocks fences", () => {
	test("a closed farmer-chart fence is a chart with its spec", () => {
		const blocks = parseBlocks(
			`\`\`\`farmer-chart\n${chartJson}\n\`\`\``,
			true,
		);
		expect(kinds(blocks)).toEqual(["chart"]);
		const block = at(blocks, 0);
		expect(block.kind === "chart" && block.spec?.data.length).toBe(2);
	});

	test("an open farmer-chart fence is a placeholder while streaming", () => {
		const blocks = parseBlocks(`\`\`\`farmer-chart\n{"type":"bar",`, true);
		const block = at(blocks, 0);
		expect(block.kind).toBe("chart");
		expect(block.kind === "chart" && block.spec).toBeNull();
	});

	test("an open farmer-chart fence is code once the turn stopped", () => {
		const blocks = parseBlocks(`\`\`\`farmer-chart\n{"type":"bar",`, false);
		const block = at(blocks, 0);
		expect(block.kind).toBe("code");
		expect(block.kind === "code" && block.lang).toBe("farmer-chart");
	});

	test("a malformed closed chart fence stays code", () => {
		const blocks = parseBlocks("```farmer-chart\n{not json}\n```", false);
		expect(kinds(blocks)).toEqual(["code"]);
	});

	test("a json fence that holds a chart spec is a chart", () => {
		const blocks = parseBlocks(`\`\`\`json\n${chartJson}\n\`\`\``, false);
		expect(kinds(blocks)).toEqual(["chart"]);
	});

	test("a json fence of other data stays code", () => {
		const blocks = parseBlocks('```json\n{"a":1}\n```', false);
		expect(kinds(blocks)).toEqual(["code"]);
	});

	test("an open farmer-next fence is not ready while streaming", () => {
		const blocks = parseBlocks("```farmer-next\n- One\n- Two", true);
		const block = at(blocks, 0);
		expect(block.kind === "next" && block.prompts).toEqual(["One", "Two"]);
		expect(block.kind === "next" && block.ready).toBe(false);
	});

	test("an open farmer-next fence is ready once the turn stopped", () => {
		const blocks = parseBlocks("```farmer-next\n- One\n- Two", false);
		const block = at(blocks, 0);
		expect(block.kind === "next" && block.ready).toBe(true);
	});

	test("a closed farmer-next fence is ready while streaming", () => {
		const blocks = parseBlocks(
			"```farmer-next\nNext steps:\n1. One\n```",
			true,
		);
		const block = at(blocks, 0);
		expect(block.kind === "next" && block.prompts).toEqual(["One"]);
		expect(block.kind === "next" && block.ready).toBe(true);
	});

	test("a fence that holds only a table is a table", () => {
		const blocks = parseBlocks(
			"```\n| A | B |\n|---|---|\n| 1 | 2 |\n```",
			false,
		);
		const block = at(blocks, 0);
		expect(block.kind).toBe("table");
		expect(block.kind === "table" && block.rows).toEqual([["1", "2"]]);
	});

	test("a fence of code stays code and keeps its language", () => {
		const blocks = parseBlocks("```ts\nconst a = 1;\n```\nafter", false);
		expect(kinds(blocks)).toEqual(["code", "p"]);
		const block = at(blocks, 0);
		expect(block.kind === "code" && block.lang).toBe("ts");
	});
});

describe("parseBlocks prose", () => {
	test("a lone table header ends, as its own paragraph", () => {
		expect(parseInChild("| A | B |", true)).toEqual(["p"]);
		expect(at(parseBlocks("| A | B |", true), 0)).toEqual({
			kind: "p",
			text: "| A | B |",
		});
	});

	test("a lone table header between lists still ends", () => {
		expect(parseInChild("- a\n| A | B |\n- b", true)).toEqual([
			"ul",
			"p",
			"ul",
		]);
	});

	test("a table with its delimiter is a table", () => {
		const blocks = parseBlocks(
			"| A | B |\n|---:|:--|\n| 1 | 2 |\n| 3 | 4 |",
			true,
		);
		const block = at(blocks, 0);
		expect(block.kind === "table" && block.rows.length).toBe(2);
		expect(block.kind === "table" && block.align).toEqual(["right", "left"]);
	});

	test("unordered lists take - and * items", () => {
		const blocks = parseBlocks("- one\n* two\n\ntext", false);
		const block = at(blocks, 0);
		expect(block.kind === "ul" && block.items).toEqual(["one", "two"]);
		expect(kinds(blocks)).toEqual(["ul", "p"]);
	});

	test("ordered lists take 1. and 1) items", () => {
		const blocks = parseBlocks("1. one\n2) two", false);
		const block = at(blocks, 0);
		expect(block.kind === "ol" && block.items).toEqual(["one", "two"]);
	});

	test("a rule is an hr", () => {
		expect(kinds(parseBlocks("a\n\n---\n\nb", false))).toEqual([
			"p",
			"hr",
			"p",
		]);
		expect(kinds(parseBlocks("***", false))).toEqual(["hr"]);
	});

	test("headings carry their level, up to three", () => {
		const blocks = parseBlocks("# One\n## Two\n### Three\n#### Four", false);
		expect(blocks.map((b) => (b.kind === "h" ? b.level : 0))).toEqual([
			1, 2, 3, 0,
		]);
		expect(kinds(blocks)).toEqual(["h", "h", "h", "p"]);
	});

	test("a paragraph runs until a block starts", () => {
		const blocks = parseBlocks("one\ntwo\n# Head\nthree", false);
		const first = at(blocks, 0);
		expect(first.kind === "p" && first.text).toBe("one\ntwo");
		expect(kinds(blocks)).toEqual(["p", "h", "p"]);
	});

	test("an empty source has no blocks", () => {
		expect(parseBlocks("", false)).toEqual([]);
		expect(parseBlocks("\n\n", true)).toEqual([]);
	});
});

describe("safeHref", () => {
	test("keeps a path, a web link and a mail link", () => {
		expect(safeHref("/acme/time")).toBe("/acme/time");
		expect(safeHref("https://example.com")).toBe("https://example.com");
		expect(safeHref("mailto:a@example.com")).toBe("mailto:a@example.com");
	});

	test("refuses a link that a browser reads as another site", () => {
		expect(safeHref("//evil.example/x")).toBeNull();
		expect(safeHref("/\\evil.example")).toBeNull();
		expect(safeHref(" //evil.example")).toBeNull();
		expect(safeHref("javascript:alert(1)")).toBeNull();
	});
});
