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
export const parseChartSpec = (source: string): ChartSpec | null => {
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

/**
 * The blocks of an answer. `streaming` changes only an open directive fence:
 * an open chart is a placeholder, and open chips are not ready yet.
 */
export const parseBlocks = (source: string, streaming: boolean): Block[] => {
	const blocks: Block[] = [];
	const lines = source.split("\n");
	let index = 0;

	while (index < lines.length) {
		const line = lines[index] ?? "";

		const fence = /^```([\w-]*)\s*$/.exec(line.trim());
		if (fence) {
			const lang = fence[1] || null;
			const body: string[] = [];
			index += 1;
			while (index < lines.length && !/^```/.test(lines[index] ?? "")) {
				body.push(lines[index] ?? "");
				index += 1;
			}
			const closed = index < lines.length;
			index += 1;
			const text = body.join("\n");

			// A closed fence whose body is a chart is a chart, with any tag:
			// a small model writes ```json for the same object.
			if (closed) {
				const spec = parseChartSpec(text);
				if (spec) {
					blocks.push({ kind: "chart", spec });
					continue;
				}
			}
			if (streaming && !closed && lang === "farmer-chart") {
				blocks.push({ kind: "chart", spec: null });
				continue;
			}
			// Chips do not wait for the closing fence: a turn that stops a
			// token early must still give the follow-ups.
			if (lang === "farmer-next") {
				blocks.push({
					kind: "next",
					prompts: parsePrompts(text),
					ready: closed || !streaming,
				});
				continue;
			}
			const table = fencedTable(body);
			if (table) {
				blocks.push(table);
				continue;
			}
			blocks.push({ kind: "code", text, lang });
			continue;
		}

		if (startsTable(line, lines[index + 1] ?? "")) {
			const table = takeTable(lines, index);
			blocks.push(table.block);
			index = table.next;
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading) {
			const length = heading[1]?.length ?? 1;
			blocks.push({
				kind: "h",
				level: length === 3 ? 3 : length === 2 ? 2 : 1,
				text: heading[2] ?? "",
			});
			index += 1;
			continue;
		}

		if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
			blocks.push({ kind: "hr" });
			index += 1;
			continue;
		}

		if (NUMBERED.test(line)) {
			const items: string[] = [];
			while (index < lines.length && NUMBERED.test(lines[index] ?? "")) {
				items.push((lines[index] ?? "").replace(NUMBERED, ""));
				index += 1;
			}
			blocks.push({ kind: "ol", items });
			continue;
		}

		if (BULLET.test(line)) {
			const items: string[] = [];
			while (index < lines.length && BULLET.test(lines[index] ?? "")) {
				items.push((lines[index] ?? "").replace(BULLET, ""));
				index += 1;
			}
			blocks.push({ kind: "ul", items });
			continue;
		}

		if (line.trim() === "") {
			index += 1;
			continue;
		}

		const paragraph: string[] = [];
		while (index < lines.length) {
			const current = lines[index] ?? "";
			if (
				current.trim() === "" ||
				BULLET.test(current) ||
				NUMBERED.test(current) ||
				/^#{1,3}\s+/.test(current) ||
				isTableLine(current) ||
				startsTable(current, lines[index + 1] ?? "") ||
				/^```/.test(current)
			) {
				break;
			}
			paragraph.push(current);
			index += 1;
		}
		// A lone table header while the answer streams matches nothing above.
		// Take the line as its own paragraph, so the loop always moves on.
		if (paragraph.length === 0) {
			paragraph.push(line);
			index += 1;
		}
		blocks.push({ kind: "p", text: paragraph.join("\n") });
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
export const isNumeric = (cell: string) =>
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
