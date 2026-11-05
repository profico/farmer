import { describe, expect, test } from "bun:test";

import {
	type Block,
	columnAlign,
	parseBlocks,
	parseInline,
	printDayKey,
	safeHref,
} from "./markdown";

const kinds = (blocks: Block[]) => blocks.map((block) => block.kind);

/** The answer of `bun run db:seed-assistant-ui`, which holds every construct
 *  the web renderer draws. */
const KITCHEN_SINK = `# Headings, at one weight

Paragraphs render with **bold**, *italic*, \`inline code\` and [a link](https://www.beautifului.dev/). A day: [[2026-10-05]].

## Lists

- A bullet
- A second bullet with \`code\` in it

1. A numbered item
2. A second one

---

## A table

| Project | Task | Hours |
|---|---|---:|
| Harbor App | Development | 12.5 |
| **Total** | | **17.0** |

\`\`\`farmer-chart
{"type":"bar","title":"Hours by project","unit":"h","data":[{"label":"Harbor App","value":52.5},{"label":"Internal","value":12.25}]}
\`\`\`

\`\`\`farmer-chart
{"type":"trend","unit":"h","data":[{"label":"Mon","value":7.5},{"label":"Tue","value":8}]}
\`\`\`

\`\`\`ts
const seconds = hours * 3600;
\`\`\`

\`\`\`farmer-chart
{"type":"bar","data":[{"label":"broken","value":"twelve"}]}
\`\`\`

\`\`\`farmer-next
How many hours did I log last week?
What have I not filed to a project yet?
\`\`\``;

describe("parseBlocks", () => {
	test("reads every construct of the seeded thread", () => {
		const blocks = parseBlocks(KITCHEN_SINK, false);
		expect(kinds(blocks)).toEqual([
			"h",
			"p",
			"h",
			"ul",
			"ol",
			"hr",
			"h",
			"table",
			"chart",
			"chart",
			"code",
			"code",
			"next",
		]);
		const table = blocks[7];
		expect(table?.kind === "table" ? table.align : null).toEqual([
			null,
			null,
			"right",
		]);
		const trend = blocks[9];
		expect(trend?.kind === "chart" ? trend.spec?.type : null).toBe("trend");
		const next = blocks[12];
		expect(next?.kind === "next" ? next.prompts : null).toEqual([
			"How many hours did I log last week?",
			"What have I not filed to a project yet?",
		]);
	});

	test("an open chart fence is a placeholder only while streaming", () => {
		const open = '```farmer-chart\n{"type":"bar","data":[{"label":"A"';
		expect(parseBlocks(open, true)).toEqual([{ kind: "chart", spec: null }]);
		expect(kinds(parseBlocks(open, false))).toEqual(["code"]);
	});

	test("open chips are read, and ready once nothing arrives", () => {
		const open = "Done.\n\n```farmer-next\nNext steps:\n- Show last week";
		const streaming = parseBlocks(open, true)[1];
		expect(streaming).toEqual({
			kind: "next",
			prompts: ["Show last week"],
			ready: false,
		});
		expect(parseBlocks(open, false)[1]).toEqual({
			kind: "next",
			prompts: ["Show last week"],
			ready: true,
		});
	});

	test("a fence that holds only a table is the table", () => {
		const fenced = "```\n| A | B |\n|---|---|\n| 1 | 2 |\n```";
		expect(kinds(parseBlocks(fenced, false))).toEqual(["table"]);
	});

	test("a lone table header while streaming does not stop the parse", () => {
		expect(kinds(parseBlocks("| Project | Hours |", true))).toEqual(["p"]);
		expect(kinds(parseBlocks("| A | B |\n| 1 |", true))).toEqual(["p", "p"]);
	});

	test("an untagged fence that parses as a chart is a chart", () => {
		const json =
			'```json\n{"type":"bar","data":[{"label":"A","value":1}]}\n```';
		expect(kinds(parseBlocks(json, false))).toEqual(["chart"]);
	});
});

describe("parseInline", () => {
	test("reads each inline construct once", () => {
		expect(
			parseInline(
				"**7.5h** on [[2026-08-03]], see `x` and *this* or [docs](https://a.example)",
			),
		).toEqual([
			{ kind: "bold", text: "7.5h" },
			{ kind: "text", text: " on " },
			{ kind: "day", day: "2026-08-03", label: "3 Aug" },
			{ kind: "text", text: ", see " },
			{ kind: "code", text: "x" },
			{ kind: "text", text: " and " },
			{ kind: "italic", text: "this" },
			{ kind: "text", text: " or " },
			{ kind: "link", text: "docs", href: "https://a.example" },
		]);
	});

	test("a link that is not a web link does not open", () => {
		expect(parseInline("[x](javascript:alert(1))")[0]).toMatchObject({
			kind: "link",
			href: null,
		});
		expect(safeHref("/acme/time")).toBeNull();
		expect(safeHref("mailto:a@b.example")).toBe("mailto:a@b.example");
	});

	test("a day that does not exist is text", () => {
		expect(parseInline("[[2026-13-40]]")).toEqual([
			{ kind: "text", text: "2026-13-40" },
		]);
		expect(printDayKey("2026-01-09")).toBe("9 Jan");
	});
});

describe("columnAlign", () => {
	test("sets a column of numbers to the right", () => {
		expect(
			columnAlign(
				["Day", "Hours"],
				[
					["Mon", "7.5h"],
					["Tue", "8"],
				],
				[null, null],
			),
		).toEqual(["left", "right"]);
	});
});
