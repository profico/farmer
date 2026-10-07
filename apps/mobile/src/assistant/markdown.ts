import { z } from "zod";

/**
 * The reader of an assistant answer: a small markdown, and the directives
 * that the system prompt describes. It is a port of the web app's reader
 * (`apps/web/src/components/assistant/answer.tsx`), and the two must read
 * the same constructs. A construct that the prompt promises and this file
 * does not read shows as its own syntax.
 *
 * The constructs: paragraphs, headings, lists, pipe tables, rules, code
 * fences, inline code, bold, italic, links, `[[YYYY-MM-DD]]` day citations,
 * `farmer-chart` fences and `farmer-next` chips. The text arrives in parts
 * while the answer streams, so every rule here must accept half of a
 * construct and never throw.
 */

export type Align = "left" | "right" | "center";

/** The JSON inside a `farmer-chart` fence. */
export type ChartSpec = {
	/** `bar`: one row for each category. `trend`: columns in time order. */
	type: "bar" | "trend";
	title?: string;
	/** Added after every value: "h", "%". */
	unit?: string;
	data: { label: string; value: number }[];
};

export type Block =
	| { kind: "p"; text: string }
	| { kind: "h"; level: 1 | 2 | 3; text: string }
	| { kind: "ul"; items: string[] }
	| { kind: "ol"; items: string[] }
	| { kind: "table"; head: string[]; rows: string[][]; align: (Align | null)[] }
	| { kind: "hr" }
	/** `spec` is null while the fence is still open. */
	| { kind: "chart"; spec: ChartSpec | null }
	| { kind: "next"; prompts: string[]; ready: boolean }
	| { kind: "code"; text: string; lang: string | null };

const chartSpecSchema = z.object({
	type: z.enum(["trend", "bar"]).catch("bar"),
	title: z.string().optional().catch(undefined),
	unit: z.string().optional().catch(undefined),
	data: z
		.array(
			z.object({
				label: z.string(),
				value: z.number().refine(Number.isFinite),
			}),
		)
		.min(1)
		.max(40),
});

/** A fence body as a chart, or null. A malformed chart shows as code, so its
 *  numbers stay on the screen. */
const parseChartSpec = (source: string): ChartSpec | null => {
	try {
		const parsed = chartSpecSchema.safeParse(JSON.parse(source));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
};

/** A pipe row with both outer pipes. Strict, because a sentence can hold a
 *  pipe. */
const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line);

/** A pipe row once a table is known to be here. */
const isTableRow = (line: string) => line.includes("|");

/** `|---|:--:|---:|`: the line that makes the row above it a header. */
const isTableDelimiter = (line: string) => {
	const trimmed = line.trim();
	if (/^\|(\s*:?-{2,}:?\s*\|)+$/.test(trimmed)) return true;
	const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
	if (!inner.includes("|")) return false;
	return /^\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+$/.test(inner);
};

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

/** A fence whose body is only a pipe table, read as the table. */
const fencedTable = (body: string[]): Block | null => {
	const lines = body.filter((line) => line.trim() !== "");
	if (lines.length < 2) return null;
	if (!startsTable(lines[0] ?? "", lines[1] ?? "")) return null;
	if (!lines.every(isTableRow)) return null;
	return takeTable(lines, 0).block;
};

/** The lines of a `farmer-next` fence as prompts. A label, a heading and a
 *  list marker are not prompts. At most four. */
const parsePrompts = (text: string) =>
	text
		.split("\n")
		.map((entry) => entry.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
		.filter(
			(entry) => entry !== "" && !entry.startsWith("#") && !entry.endsWith(":"),
		)
		.slice(0, 4);

const BULLET = /^\s*[-*]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

/** A block read from `lines`, and the index of the first line after it. A
 *  blank line gives `null` and is skipped. `next` is always past the line
 *  where the reader started, or the loop would never end. */
type Read = { block: Block | null; next: number };

/** A fence body as the block it stands for. `streaming` changes only an
 *  open directive fence. */
const fenceBlock = (
	text: string,
	body: string[],
	lang: string | null,
	closed: boolean,
	streaming: boolean,
): Block => {
	// A closed fence whose body is a chart is a chart, with any tag:
	// a small model writes ```json for the same object.
	if (closed) {
		const spec = parseChartSpec(text);
		if (spec) return { kind: "chart", spec };
	}
	if (streaming && !closed && lang === "farmer-chart") {
		return { kind: "chart", spec: null };
	}
	// Chips do not wait for the closing fence: a turn that stops a
	// token early must still give the follow-ups.
	if (lang === "farmer-next") {
		return {
			kind: "next",
			prompts: parsePrompts(text),
			ready: closed || !streaming,
		};
	}
	return fencedTable(body) ?? { kind: "code", text, lang };
};

/** A fenced block, or null when the line at `start` opens no fence. An open
 *  fence runs to the end of the text that has arrived. */
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

const readHeading = (line: string): Block | null => {
	const heading = HEADING.exec(line);
	if (!heading) return null;
	const length = heading[1]?.length ?? 1;
	return {
		kind: "h",
		level: length === 3 ? 3 : length === 2 ? 2 : 1,
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

/** Whether a paragraph stops before `line`. */
const endsParagraph = (line: string, next: string) =>
	line.trim() === "" ||
	BULLET.test(line) ||
	NUMBERED.test(line) ||
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
	// A lone table header while the answer streams matches nothing above.
	// Take the line as its own paragraph, so the loop always moves on.
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
	if (startsTable(line, lines[index + 1] ?? "")) return takeTable(lines, index);
	const heading = readHeading(line);
	if (heading) return { block: heading, next: index + 1 };
	if (RULE.test(line)) return { block: { kind: "hr" }, next: index + 1 };
	if (NUMBERED.test(line)) return takeList(lines, index, NUMBERED, "ol");
	if (BULLET.test(line)) return takeList(lines, index, BULLET, "ul");
	if (line.trim() === "") return { block: null, next: index + 1 };
	return takeParagraph(lines, index);
};

/**
 * The blocks of an answer. `streaming` changes only an open directive fence:
 * an open chart is a placeholder, and open chips are not ready yet.
 */
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

export type Inline =
	| { kind: "text"; text: string }
	| { kind: "code"; text: string }
	| { kind: "bold"; text: string }
	| { kind: "italic"; text: string }
	/** `[[2026-08-03]]`, with its label "3 Aug". */
	| { kind: "day"; day: string; label: string }
	/** `href` is null for an address that is not a plain web link. */
	| { kind: "link"; text: string; href: string | null };

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** "2026-08-03" as "3 Aug", or null for a day that does not exist. A label,
 *  not an instant: no `Date`, so no time zone can move the day. */
export const printDayKey = (day: string) => {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
	if (!match) return null;
	const month = Number(match[2]);
	const date = Number(match[3]);
	if (month < 1 || month > 12 || date < 1 || date > 31) return null;
	return `${date} ${MONTHS[month - 1]}`;
};

/** Only an https, http or mail link opens. The model writes links from data
 *  it read, so `javascript:` can come from a project name. A path of the
 *  server has no meaning in the app. */
export const safeHref = (href: string) =>
	/^(https?:\/\/|mailto:)/i.test(href.trim()) ? href.trim() : null;

const INLINE =
	/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[\[\d{4}-\d{2}-\d{2}\]\]|\[[^\]\n]+\]\([^)\s]+\))/g;

/** The inline parts of a line, in one pass, so that no part can take
 *  another. */
export const parseInline = (text: string): Inline[] => {
	const parts: Inline[] = [];
	for (const part of text.split(INLINE)) {
		if (part === "") continue;
		if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
			parts.push({ kind: "code", text: part.slice(1, -1) });
			continue;
		}
		if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
			parts.push({ kind: "bold", text: part.slice(2, -2) });
			continue;
		}
		if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
			parts.push({ kind: "italic", text: part.slice(1, -1) });
			continue;
		}
		const citation = /^\[\[(\d{4}-\d{2}-\d{2})\]\]$/.exec(part);
		if (citation?.[1]) {
			const label = printDayKey(citation[1]);
			parts.push(
				label
					? { kind: "day", day: citation[1], label }
					: { kind: "text", text: citation[1] },
			);
			continue;
		}
		const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
		if (link) {
			parts.push({
				kind: "link",
				text: link[1] ?? "",
				href: safeHref(link[2] ?? ""),
			});
			continue;
		}
		parts.push({ kind: "text", text: part });
	}
	return parts;
};

/** A cell that is a quantity and nothing else: `7.25`, `-3`, `82%`. */
const isNumeric = (cell: string) =>
	/^[-+]?[$€£]?\s?\d[\d\s,.]*\s?(%|h|hrs?|€|\$|£)?$/i.test(cell.trim());

/** The alignment of each column: the delimiter's, else right for a column
 *  of numbers, else left. */
export const columnAlign = (
	head: string[],
	rows: string[][],
	align: (Align | null)[],
): Align[] => {
	const count = rows.reduce(
		(widest, row) => Math.max(widest, row.length),
		head.length,
	);
	return Array.from({ length: count }, (_, column) => {
		const given = align[column];
		if (given) return given;
		const cells = rows
			.map((row) => row[column]?.trim() ?? "")
			.filter((cell) => cell !== "");
		return cells.length > 0 && cells.every(isNumeric) ? "right" : "left";
	});
};

/** A value as a chart prints it: "7.5h", not "7.50h". */
export const printValue = (value: number, unit?: string) =>
	`${Math.round(value * 100) / 100}${unit ?? ""}`;
