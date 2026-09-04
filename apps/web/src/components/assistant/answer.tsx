import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";

import { useOrgSlug } from "#/hooks/use-org-slug.ts";

import {
	AnswerChart,
	type ChartSpec,
	parseChartSpec,
} from "./answer-chart.tsx";

// A deliberately small markdown reader.
//
// Models write markdown whether or not you ask them to, so rendering the raw
// string leaves `**bold**` and stray hyphens all over the answer. The full
// grammar is not the point here: what shows up in answers about a timesheet is
// paragraphs, lists, headings, inline code, bold — and, once a question is
// about more than one number, TABLES. "Hours per project last month" is a table
// whatever you do to the prompt, and a table rendered as raw pipes is the one
// failure that makes the answer harder to read than no formatting at all.
// Everything outside this set still falls through as text.
//
// The alternative was a markdown dependency — react-markdown plus remark-gfm
// plus a sanitiser, all of it shipped to the browser — in an app whose only
// other renderer is Typst on the server. Still not worth it, but the bar for
// what has to be here has moved: see `systemPrompt` in assistant-tools.ts,
// which is where the model is told what this renderer understands. Keep the two
// in step — a construct promised there and missing here renders as syntax.
//
// Everything below has to survive a HALF-ARRIVED string: it re-parses from
// scratch on every streamed delta. Hence the unterminated-fence rule, and hence
// a table that is still one header row wide rendering as a paragraph until its
// delimiter line lands.
//
// Two constructs are NOT markdown and are worth naming as the exception they
// are: a fence tagged `farmer-chart` or `farmer-next` is a DIRECTIVE — a chart
// and a set of follow-up chips respectively. They ride on the fence syntax
// because that is the one construct a model already knows how to close, and
// because anything it emits that this file doesn't recognise then degrades to a
// visible code block rather than to invisible. Nothing here is a component the
// model can compose: it picks from a fixed set and fills in data, which is the
// difference between generative UI and letting a model write markup.
//
// Two rules below exist because the model on the other end is whatever the org
// chose as its default, and a small one writes sloppier markdown than the
// prompt asks for: a fence whose body is nothing but a pipe table is read as
// that table, and the chip fence is read whether or not it was closed. Both
// recover from a wrapper the model ADDED, never from data it left out — a
// directive the model didn't write is still a directive nobody gets.

/** `null` is a delimiter that carried no colon — not "left", which is what a
 *  bare `---` used to become. The distinction is what lets a column of numbers
 *  be set right without overriding a model that asked for something else. */
type Align = "left" | "right" | "center";

type Block =
	| { kind: "p"; text: string }
	| { kind: "h"; level: 1 | 2 | 3; text: string }
	| { kind: "ul"; items: string[] }
	| { kind: "ol"; items: string[] }
	| { kind: "table"; head: string[]; rows: string[][]; align: (Align | null)[] }
	| { kind: "hr" }
	| { kind: "chart"; spec: ChartSpec }
	| { kind: "next"; prompts: string[] }
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

const parseBlocks = (source: string): Block[] => {
	const blocks: Block[] = [];
	const lines = source.split("\n");
	let index = 0;

	while (index < lines.length) {
		const line = lines[index] ?? "";

		// Fenced code. An unterminated fence (the usual case mid-stream) runs to
		// the end of what has arrived so far, which is what makes code stream
		// legibly instead of appearing all at once when the closing fence lands.
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

			// A directive is only read once its fence has CLOSED. Half a JSON object
			// parses as nothing, so an open chart fence would otherwise flicker
			// between "malformed, show the code" and the chart on the last token.
			if (lang === "farmer-chart" && closed) {
				const spec = parseChartSpec(text);
				// Malformed on purpose falls through to the code block below: the
				// numbers are in there, and a chart that silently vanishes takes them
				// with it.
				if (spec) {
					blocks.push({ kind: "chart", spec });
					continue;
				}
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
				blocks.push({ kind: "next", prompts: parsePrompts(text) });
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

		// A table is a header row, a delimiter, then rows — the delimiter is what
		// distinguishes it from a sentence that happens to contain a pipe, so both
		// of the first two lines have to be here before anything is a table.
		if (startsTable(line, lines[index + 1] ?? "")) {
			const table = takeTable(lines, index);
			blocks.push(table.block);
			index = table.next;
			continue;
		}

		const heading = /^(#{1,3})\s+(.*)$/.exec(line);
		if (heading) {
			blocks.push({
				kind: "h",
				// SAFETY: the regex two lines up is `^(#{1,3})`, so group 1 is one to three
				// characters and its length is exactly this union.
				level: (heading[1]?.length ?? 1) as 1 | 2 | 3,
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

		if (/^\s*\d+[.)]\s+/.test(line)) {
			const items: string[] = [];
			while (
				index < lines.length &&
				/^\s*\d+[.)]\s+/.test(lines[index] ?? "")
			) {
				items.push((lines[index] ?? "").replace(/^\s*\d+[.)]\s+/, ""));
				index += 1;
			}
			blocks.push({ kind: "ol", items });
			continue;
		}

		if (/^\s*[-*]\s+/.test(line)) {
			const items: string[] = [];
			while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? "")) {
				items.push((lines[index] ?? "").replace(/^\s*[-*]\s+/, ""));
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
		while (
			index < lines.length &&
			(lines[index] ?? "").trim() !== "" &&
			!/^\s*[-*]\s+/.test(lines[index] ?? "") &&
			!/^\s*\d+[.)]\s+/.test(lines[index] ?? "") &&
			!/^#{1,3}\s+/.test(lines[index] ?? "") &&
			!isTableLine(lines[index] ?? "") &&
			!startsTable(lines[index] ?? "", lines[index + 1] ?? "") &&
			!/^```/.test(lines[index] ?? "")
		) {
			paragraph.push(lines[index] ?? "");
			index += 1;
		}
		// A lone table header mid-stream matches nothing above and nothing here,
		// which would spin forever — take the line as its own paragraph.
		if (paragraph.length === 0) {
			paragraph.push(line);
			index += 1;
		}
		blocks.push({ kind: "p", text: paragraph.join("\n") });
	}

	return blocks;
};

/** Anything that isn't a plain web link is rendered as text rather than as an
 *  anchor. The model composes these from data it read, so `javascript:` is
 *  reachable from a project name if nothing checks. */
const safeHref = (href: string) =>
	/^(https?:\/\/|mailto:|\/)/i.test(href.trim()) ? href.trim() : null;

/**
 * A day the answer is citing, as `[[2026-08-03]]`, rendered as a link to that
 * day's timesheet.
 *
 * This is the citation story, and it is deliberately the cheap half of it. The
 * expensive half — every figure carrying the ids of the entries it was summed
 * from — needs the read tools to return those ids alongside their totals, which
 * is a change to what every report answers with. A date is the one handle the
 * model always already has, it is the coordinate the app is actually organised
 * by, and "where did 37.5h come from" is answered by landing on the day and
 * looking. Anything that isn't a real calendar date renders as plain text, so
 * a hallucinated citation is inert rather than a link to nowhere.
 */
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

/** "2026-08-03" → "3 Aug", or null if it isn't a real day.
 *
 *  Hand-rolled rather than date-fns because a day key here is a LABEL, not an
 *  instant: parsing it into a Date to print it back introduces the local
 *  midnight that `lib/time.ts` exists to keep out of this app, and the one
 *  timezone bug worth never having is the one that renders the wrong date. */
const printDayKey = (day: string) => {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
	if (!match) return null;
	const month = Number(match[2]);
	const date = Number(match[3]);
	if (month < 1 || month > 12 || date < 1 || date > 31) return null;
	return `${date} ${MONTHS[month - 1]}`;
};

function DayCitation({ day }: { day: string }) {
	const orgSlug = useOrgSlug();
	const label = printDayKey(day);
	if (!label) return <>{day}</>;
	return (
		<Link
			to="/$orgSlug/time"
			params={{ orgSlug }}
			search={{ date: day }}
			className="underlined text-ink"
		>
			{label}
		</Link>
	);
}

/** Inline `code`, **bold**, *italic*, [links](…) and `[[date]]` citations, in
 *  one pass so none of them can swallow another. */
const renderInline = (text: string) => {
	const parts = text.split(
		/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[\[\d{4}-\d{2}-\d{2}\]\]|\[[^\]\n]+\]\([^)\s]+\))/g,
	);
	return parts.map((part, index) => {
		const key = `${index}-${part.slice(0, 8)}`;
		if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
			return (
				<code
					key={key}
					className="rounded-[4px] bg-inset px-1 py-0.5 font-mono text-[12px] text-ink"
				>
					{part.slice(1, -1)}
				</code>
			);
		}
		if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
			return (
				<strong key={key} className="font-medium text-ink">
					{part.slice(2, -2)}
				</strong>
			);
		}
		if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
			return <em key={key}>{part.slice(1, -1)}</em>;
		}
		const citation = /^\[\[(\d{4}-\d{2}-\d{2})\]\]$/.exec(part);
		if (citation?.[1]) {
			return <DayCitation key={key} day={citation[1]} />;
		}
		const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
		if (link) {
			const href = safeHref(link[2] ?? "");
			if (!href) return <Fragment key={key}>{link[1]}</Fragment>;
			return (
				<a
					key={key}
					href={href}
					target="_blank"
					rel="noreferrer noopener"
					className="underlined text-ink"
				>
					{link[1]}
				</a>
			);
		}
		return <Fragment key={key}>{part}</Fragment>;
	});
};

const alignClass = {
	left: "text-left",
	right: "text-right",
	center: "text-center",
} satisfies Record<Align, string>;

/** A cell that is a quantity and nothing else — `7.25`, `-3`, `82%`, `1,204`. */
const isNumeric = (cell: string) =>
	/^[-+]?[$€£]?\s?\d[\d\s,.]*\s?(%|h|hrs?|€|\$|£)?$/i.test(cell.trim());

/** Over this many characters a column is prose. Under it, it is a label: a
 *  date, an amount, a name, a status. */
const PROSE_AT = 28;

type Column = {
	align: Align;
	numeric: boolean;
	wraps: boolean;
	prose: boolean;
};

/**
 * What each column is, which is more than its delimiter said.
 *
 * `table-layout: auto` under a width the table cannot have shrinks every column
 * towards its MIN-content width, roughly in proportion to what each one asked
 * for — and a browser will break `2026-08-28` at its hyphens to get there. So a
 * date column folds onto two lines beside a free-text column that had room to
 * spare, which is the one thing a data table must not do: the short column is
 * the one a reader scans down. Pinning every short column with `nowrap` makes
 * its min-content its max-content, so the whole shrink lands on the prose
 * column that can absorb it. If NOTHING here is prose nothing is pinned — a
 * table of fifteen short columns has no column to absorb anything, and wrapping
 * them is a better answer there than an inner scrollbar.
 */
const measureColumns = (
	head: string[],
	rows: string[][],
	align: (Align | null)[],
): Column[] => {
	const count = rows.reduce(
		(widest, row) => Math.max(widest, row.length),
		head.length,
	);
	const lengths: number[] = [];
	const numerics: boolean[] = [];
	for (let column = 0; column < count; column += 1) {
		const cells = rows
			.map((row) => row[column]?.trim() ?? "")
			.filter((cell) => cell !== "");
		lengths.push(
			cells.reduce(
				(widest, cell) => Math.max(widest, cell.length),
				head[column]?.length ?? 0,
			),
		);
		numerics.push(cells.length > 0 && cells.every(isNumeric));
	}
	const hasProse = lengths.some((length) => length > PROSE_AT);
	return lengths.map((length, column) => ({
		align: align[column] ?? (numerics[column] ? "right" : "left"),
		numeric: numerics[column] === true,
		prose: hasProse && length > PROSE_AT,
		wraps: hasProse ? length > PROSE_AT : true,
	}));
};

/** Compact, and deliberately NOT `components/ui/table.tsx`: that one bleeds to
 *  its island's edges and carries 32px gutters, which is right for a screen
 *  whose subject is the table and wrong for four rows inside a sentence. Same
 *  tokens, so it still reads as the same furniture. */
function AnswerTable({
	head,
	rows,
	align,
}: {
	head: string[];
	rows: string[][];
	align: (Align | null)[];
}) {
	const columns = measureColumns(head, rows, align);
	const cellClass = (index: number) => {
		const column = columns[index];
		return [
			alignClass[column?.align ?? "left"],
			column?.numeric === true ? "tabular-nums" : "",
			column?.wraps === false ? "whitespace-nowrap" : "",
			// A floor under the PROSE column only, for the phone: five columns
			// cannot all fit there, and prose is the only one allowed to shrink, so
			// it collapses into a two-word ribbon forty lines deep while every short
			// column keeps its full width. A scroll inside the card is the better
			// trade at that width. A table with no prose column gets no floor — it
			// is short enough to fit, and 22ch times six columns is not.
			column?.prose === true ? "min-w-[22ch]" : "",
		].join(" ");
	};
	return (
		// `answer-wide` (styles.css) is what lets a table with a description
		// column leave the reading column instead of being folded into a
		// scrollbar inside it. The inner scroller is the last resort for the one
		// that is wider than the screen even so.
		<div className="answer-wide">
			<div className="overflow-x-auto rounded-card border border-line bg-surface">
				<table className="w-full border-collapse text-[13px]">
					<thead>
						<tr className="border-b border-line bg-inset">
							{head.map((cell, column) => (
								<th
									// oxlint-disable-next-line react/no-array-index-key -- re-derived from one string on every delta, so position IS the identity
									key={column}
									className={`eyebrow px-3 py-2 align-bottom ${cellClass(column)}`}
								>
									{renderInline(cell)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row, rowIndex) => (
							<tr
								// oxlint-disable-next-line react/no-array-index-key -- same as above — the last row is rewritten character by character while it streams
								key={rowIndex}
								className="border-b border-line2 last:border-0"
							>
								{row.map((cell, column) => (
									<td
										// oxlint-disable-next-line react/no-array-index-key -- same as above
										key={column}
										className={`px-3 py-2 align-top ${cellClass(column)}`}
									>
										{cell.trim() === "" ? (
											// A blank cell and a missing one look alike, and a column of
											// them reads as a broken table rather than as "no project".
											<span className="text-faint">—</span>
										) : (
											renderInline(cell)
										)}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

/**
 * Copy the answer — as the MARKDOWN the model wrote, not as rendered text.
 *
 * Which is the whole point of having it: the thing worth copying out of this
 * screen is a table, and a table stripped of its pipes is four columns of words
 * run together. Pasted into Slack, Notion or a PR description the source
 * renders back into the same table.
 */
export function AnswerActions({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	// Clears itself, and cleans up if the message unmounts (a thread switched
	// mid-timeout) so the timer can't fire into a gone component.
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1600);
		return () => clearTimeout(timer);
	}, [copied]);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
		} catch {
			// Denied permission or an insecure origin. Nothing useful to say and
			// nothing to fall back to — the text is on screen and selectable.
		}
	};

	return (
		// Revealed on hover of the message, and always present for keyboard and
		// touch (neither of which has a hover to reveal it with).
		<div className="-mt-1 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/answer:opacity-100 focus-within:opacity-100 md:opacity-0 max-md:opacity-100">
			<button
				type="button"
				onClick={() => void copy()}
				title="Copy this answer"
				aria-label="Copy this answer"
				className="quiet flex items-center gap-1.5 rounded-control px-1.5 py-1 text-[12px] transition-colors duration-100 hover:bg-hover"
			>
				{copied ? (
					<CheckIcon weight="regular" className="size-3.5" />
				) : (
					<CopyIcon weight="regular" className="size-3.5" />
				)}
				{copied ? "Copied" : "Copy"}
			</button>
		</div>
	);
}

export function Answer({
	text,
	onFollowUp,
}: {
	text: string;
	/** Sends a follow-up chip's prompt as the next message. Absent while a turn
	 *  is in flight, which is what makes the chips inert until it settles. */
	onFollowUp?: (prompt: string) => void;
}) {
	if (!text.trim()) return null;
	return (
		<div className="flex flex-col gap-2.5 text-[13.5px] leading-relaxed text-ink">
			{parseBlocks(text).map((block, index) => {
				const key = `${block.kind}-${index}`;
				if (block.kind === "code") {
					return (
						<pre
							key={key}
							className="overflow-auto rounded-control bg-inset p-2.5 font-mono text-[12px] leading-relaxed text-ink-2"
						>
							<code>{block.text}</code>
						</pre>
					);
				}
				if (block.kind === "table") {
					return (
						<AnswerTable
							key={key}
							head={block.head}
							rows={block.rows}
							align={block.align}
						/>
					);
				}
				if (block.kind === "chart") {
					// Same escape as the table's, and the case it exists for is the
					// forty-column trend: at the reading column's width its columns are
					// 8px of bar under a label nobody can read.
					return (
						<div key={key} className="answer-wide">
							<AnswerChart spec={block.spec} />
						</div>
					);
				}
				if (block.kind === "next") {
					// No handler means the turn is still running: render them so the
					// answer doesn't reflow when it settles, but don't offer a click
					// that would abandon the answer being read.
					if (block.prompts.length === 0) return null;
					return (
						<div key={key} className="mt-0.5 flex flex-wrap gap-1.5">
							{block.prompts.map((prompt) => (
								<button
									key={prompt}
									type="button"
									disabled={!onFollowUp}
									onClick={() => onFollowUp?.(prompt)}
									className="rounded-control px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 shadow-hairline transition-colors duration-100 enabled:hover:bg-hover enabled:hover:text-ink disabled:opacity-60"
								>
									{prompt}
								</button>
							))}
						</div>
					);
				}
				if (block.kind === "hr") {
					return <hr key={key} className="border-line2" />;
				}
				if (block.kind === "h") {
					// One step of emphasis for all three levels: an answer is a few
					// hundred words, so a heading here separates sections — it doesn't
					// need to encode a hierarchy the reader has to follow.
					return (
						<div
							key={key}
							className="mt-1 font-medium text-ink first:mt-0 [&:not(:first-child)]:pt-0.5"
						>
							{renderInline(block.text)}
						</div>
					);
				}
				if (block.kind === "ol") {
					return (
						<ol key={key} className="flex flex-col gap-1 pl-1">
							{block.items.map((item, itemIndex) => (
								<li
									// oxlint-disable-next-line react/no-array-index-key -- the list is re-derived from one string on every delta, so position IS the identity — keying on content would remount the last item on each character
									key={itemIndex}
									className="flex gap-2"
								>
									<span className="shrink-0 text-ink-3 tabular-nums">
										{itemIndex + 1}.
									</span>
									<span className="min-w-0">{renderInline(item)}</span>
								</li>
							))}
						</ol>
					);
				}
				if (block.kind === "ul") {
					return (
						<ul key={key} className="flex flex-col gap-1 pl-1">
							{block.items.map((item, itemIndex) => (
								<li
									// oxlint-disable-next-line react/no-array-index-key -- the list is re-derived from one string on every delta, so position IS the identity — keying on content would remount the last bullet on each character
									key={itemIndex}
									className="flex gap-2"
								>
									<span
										aria-hidden
										className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3"
									/>
									<span className="min-w-0">{renderInline(item)}</span>
								</li>
							))}
						</ul>
					);
				}
				return (
					<p key={key} className="whitespace-pre-wrap">
						{renderInline(block.text)}
					</p>
				);
			})}
		</div>
	);
}
