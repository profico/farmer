// The block reader of an assistant answer: markdown plus the two directive
// fences, as pure data. `answer.tsx` draws the blocks. See the note at the top
// of that file for what the reader accepts and why.

import {
	type ChartOutline,
	type ChartSpec,
	outlineChart,
	parseChartSpec,
} from "./answer-chart.tsx";

/** `null` is a delimiter that carried no colon — not "left", which is what a
 *  bare `---` used to become. The distinction is what lets a column of numbers
 *  be set right without overriding a model that asked for something else. */
export type Align = "left" | "right" | "center";

export type Block =
	| { kind: "p"; text: string }
	| { kind: "h"; level: 1 | 2 | 3; text: string }
	| { kind: "ul"; items: string[] }
	| { kind: "ol"; items: string[] }
	| { kind: "table"; head: string[]; rows: string[][]; align: (Align | null)[] }
	| { kind: "hr" }
	// One kind for both halves of a chart's life, rather than a second kind for
	// the fence that is still open. The key a block is rendered under is its kind
	// and its position, so a second kind would change that key on the token the
	// fence closed — React would remount, and the crossfade between the
	// placeholder and the chart would never run. `outline` is what the
	// placeholder is drawn from and is ignored once `spec` lands.
	| { kind: "chart"; spec: ChartSpec | null; outline: ChartOutline }
	| { kind: "next"; prompts: string[]; ready: boolean }
	| { kind: "code"; text: string; lang: string | null };

/** A pipe row with both of its outer pipes — strict, because this is also what
 *  stops a paragraph, and a sentence is allowed to contain a pipe. */
const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line);

/** A pipe row once a table is already known to be here. Loose on purpose: GFM
 *  makes the outer pipes optional and a small model drops the trailing one
 *  often — the delimiter below has already established that these are rows, so
 *  there is nothing left for strictness to protect. */
const isTableRow = (line: string) => line.includes("|");

/** `|---|:--:|---:|` — the line that turns the row above it into a header, and
 *  the only thing that distinguishes a table from a sentence with a pipe in it.
 *  The outer pipes are optional here too, but an inner one is not: without it
 *  `---` is a horizontal rule. */
const isTableDelimiter = (line: string) => {
	const trimmed = line.trim();
	if (/^\|(\s*:?-{2,}:?\s*\|)+$/.test(trimmed)) return true;
	const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
	if (!inner.includes("|")) return false;
	return /^\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+$/.test(inner);
};

/** Where a table starts: any pipe row whose next line is a delimiter. */
const startsTable = (line: string, next: string) =>
	isTableRow(line) && isTableDelimiter(next);

const splitRow = (line: string) =>
	line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());

const alignOf = (spec: string): Align | null => {
	const trimmed = spec.trim();
	if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
	if (trimmed.endsWith(":")) return "right";
	if (trimmed.startsWith(":")) return "left";
	return null;
};

/** The header row at `start`, its delimiter, and every row under it. */
const takeTable = (lines: string[], start: number) => {
	const head = splitRow(lines[start] ?? "");
	const align = splitRow(lines[start + 1] ?? "").map(alignOf);
	let index = start + 2;
	const rows: string[][] = [];
	while (index < lines.length && isTableRow(lines[index] ?? "")) {
		rows.push(splitRow(lines[index] ?? ""));
		index += 1;
	}
	const block: Block = { kind: "table", head, rows, align };
	return { block, next: index };
};

/**
 * A table the model wrapped in a code fence, read as the table it is.
 *
 * Nobody asked for this shape: a fence is what a weaker model reaches for when
 * a table's columns look ragged to it — a wide free-text column is the usual
 * trigger — and the result on screen is the one failure this whole file exists
 * to prevent, raw pipes and a horizontal scrollbar. Only a body that is
 * ENTIRELY table lines is read this way, so a fence around real code, or around
 * a table with a sentence under it, is still code.
 */
const fencedTable = (body: string[]): Block | null => {
	const lines = body.filter((line) => line.trim() !== "");
	if (lines.length < 2) return null;
	if (!startsTable(lines[0] ?? "", lines[1] ?? "")) return null;
	if (!lines.every(isTableRow)) return null;
	return takeTable(lines, 0).block;
};

/** The lines of a `farmer-next` block, as the prompts they stand for.
 *
 *  Tolerant on purpose. A chip is a message the reader would have typed, so
 *  anything that is plainly not one — the "Next steps:" label a model likes to
 *  write above its own list, a heading, a leading bullet or number — is
 *  furniture rather than a follow-up, and is dropped rather than offered as
 *  something to send. */
const parsePrompts = (text: string) =>
	text
		.split("\n")
		.map((entry) => entry.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
		.filter(
			(entry) => entry !== "" && !entry.startsWith("#") && !entry.endsWith(":"),
		)
		.slice(0, 4);

/** A block read from `lines`, and the index of the first line after it. A
 *  line that carries no block (a blank one) gives `null` and is skipped.
 *
 *  `next` is always past the line the reader started on. A reader that
 *  leaves it behind is a tab that hangs on the next streamed delta. */
type Read = { block: Block | null; next: number };

const ORDERED_ITEM = /^\s*\d+[.)]\s+/;
const BULLET_ITEM = /^\s*[-*]\s+/;

/** The text of a fence, as the block it stands for.
 *
 *  `streaming` is the turn's own state, and the only thing it decides is what
 *  an OPEN directive fence becomes — see the note at the top of `answer.tsx`. */
const fenceBlock = (
	text: string,
	body: string[],
	lang: string | null,
	closed: boolean,
	streaming: boolean,
): Block => {
	// A directive is only read once its fence has CLOSED. Half a JSON object
	// parses as nothing, so an open chart fence would otherwise flicker
	// between "malformed, show the code" and the chart on the last token.
	//
	// The TAG is deliberately not required, for the same reason `fencedTable`
	// above exists: `farmer-chart` is the contract, and a model that knows
	// the shape but reaches for ```json — or for no tag at all — puts the one
	// thing this file exists to prevent on screen, a wall of raw JSON with a
	// horizontal scrollbar and the numbers locked inside it. What identifies
	// a chart is that the body IS one: `parseChartSpec` validates the whole
	// object against a schema whose `data` is a non-empty array of
	// `{label, value}`, so any other JSON in any other fence is still code.
	// Like the table recovery, this can only re-read a wrapper the model
	// added — it cannot invent a chart from something that is not one.
	if (closed) {
		const spec = parseChartSpec(text);
		// Malformed on purpose falls through to the code block below: the
		// numbers are in there, and a chart that silently vanishes takes them
		// with it.
		if (spec) return { kind: "chart", spec, outline: outlineChart(text) };
	}
	// A chart that is still arriving, as a box the size of the chart it is
	// going to be. Only while the turn is running, and only for the TAGGED
	// fence: a stopped turn holding half a chart still shows its numbers as
	// code, and the untagged recovery above cannot be seen coming — what
	// identifies a chart there is that the body parses as one, which half an
	// object never does.
	if (streaming && !closed && lang === "farmer-chart") {
		return { kind: "chart", spec: null, outline: outlineChart(text) };
	}
	// Chips do NOT wait for the closing fence, and the asymmetry with the
	// chart above is deliberate: every line here stands on its own, so half
	// of one is a chip that grows rather than a parse that fails. It is also
	// the last thing in the answer and so the first casualty of a turn that
	// stops a token early — and a truncated fence rendering the follow-ups as
	// a code block is exactly how they stop being clickable.
	if (lang === "farmer-next") {
		// Unlike a chart, an empty or broken chip list is decoration nobody
		// loses anything by not seeing.
		//
		// `ready` is what the chips are DRAWN as, not whether they were read:
		// they are parsed either way, so the paragraph above still holds. An
		// open fence is a box while the turn runs, because a chip that grows
		// one character at a time is a button whose label keeps changing under
		// the pointer — and chips, not a box, the moment nothing is arriving.
		return {
			kind: "next",
			prompts: parsePrompts(text),
			ready: closed || !streaming,
		};
	}
	return fencedTable(body) ?? { kind: "code", text, lang };
};

/** Fenced code, or null when the line at `start` does not open a fence.
 *
 *  An unterminated fence (the usual case mid-stream) runs to the end of what
 *  has arrived so far, which is what makes code stream legibly instead of
 *  appearing all at once when the closing fence lands. */
const readFence = (
	lines: string[],
	start: number,
	streaming: boolean,
): Read | null => {
	const fence = /^```([\w-]*)\s*$/.exec((lines[start] ?? "").trim());
	if (!fence) return null;
	const lang = fence[1] || null;
	const body: string[] = [];
	let index = start + 1;
	while (index < lines.length && !/^```/.test(lines[index] ?? "")) {
		body.push(lines[index] ?? "");
		index += 1;
	}
	const closed = index < lines.length;
	const block = fenceBlock(body.join("\n"), body, lang, closed, streaming);
	return { block, next: index + 1 };
};

const headingBlock = (line: string): Block | null => {
	const heading = /^(#{1,3})\s+(.*)$/.exec(line);
	if (!heading) return null;
	return {
		kind: "h",
		// SAFETY: the regex above is `^(#{1,3})`, so group 1 is one to three
		// characters and its length is exactly this union.
		level: (heading[1]?.length ?? 1) as 1 | 2 | 3,
		text: heading[2] ?? "",
	};
};

/** The run of list items from `start`, which the caller has matched. */
const takeList = (
	lines: string[],
	start: number,
	pattern: RegExp,
	kind: "ol" | "ul",
): Read => {
	const items: string[] = [];
	let index = start;
	while (index < lines.length && pattern.test(lines[index] ?? "")) {
		items.push((lines[index] ?? "").replace(pattern, ""));
		index += 1;
	}
	return { block: { kind, items }, next: index };
};

/** Whether `line` is a line a paragraph cannot run into. */
const endsParagraph = (line: string, next: string) =>
	line.trim() === "" ||
	BULLET_ITEM.test(line) ||
	ORDERED_ITEM.test(line) ||
	/^#{1,3}\s+/.test(line) ||
	isTableLine(line) ||
	startsTable(line, next) ||
	/^```/.test(line);

const takeParagraph = (lines: string[], start: number): Read => {
	const paragraph: string[] = [];
	let index = start;
	while (
		index < lines.length &&
		!endsParagraph(lines[index] ?? "", lines[index + 1] ?? "")
	) {
		paragraph.push(lines[index] ?? "");
		index += 1;
	}
	// A lone table header mid-stream matches nothing in `readBlock` and nothing
	// above, which would spin forever — take the line as its own paragraph.
	if (paragraph.length === 0) {
		paragraph.push(lines[start] ?? "");
		index += 1;
	}
	return { block: { kind: "p", text: paragraph.join("\n") }, next: index };
};

const readBlock = (
	lines: string[],
	index: number,
	streaming: boolean,
): Read => {
	const line = lines[index] ?? "";
	const fence = readFence(lines, index, streaming);
	if (fence) return fence;

	// A table is a header row, a delimiter, then rows — the delimiter is what
	// distinguishes it from a sentence that happens to contain a pipe, so both
	// of the first two lines have to be here before anything is a table.
	if (startsTable(line, lines[index + 1] ?? "")) return takeTable(lines, index);

	const heading = headingBlock(line);
	if (heading) return { block: heading, next: index + 1 };
	if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line))
		return { block: { kind: "hr" }, next: index + 1 };
	if (ORDERED_ITEM.test(line))
		return takeList(lines, index, ORDERED_ITEM, "ol");
	if (BULLET_ITEM.test(line)) return takeList(lines, index, BULLET_ITEM, "ul");
	if (line.trim() === "") return { block: null, next: index + 1 };
	return takeParagraph(lines, index);
};

export const parseBlocks = (source: string, streaming: boolean): Block[] => {
	const blocks: Block[] = [];
	const lines = source.split("\n");
	let index = 0;
	while (index < lines.length) {
		const { block, next } = readBlock(lines, index, streaming);
		if (block) blocks.push(block);
		index = next;
	}
	return blocks;
};
