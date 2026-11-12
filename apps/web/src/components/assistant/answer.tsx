import { ArrowSquareOutIcon, CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";

import { FadeSwap } from "#/components/ui/fade-swap.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { useToday } from "#/hooks/use-today.ts";
import { dateSearch } from "#/lib/time-search.ts";

import { AnswerChart, ChartPlaceholder } from "./answer-chart.tsx";
import { ChartExport, TableExport } from "./answer-export-actions.tsx";
import {
	type Align,
	type Block,
	parseBlocks,
	safeHref,
} from "./answer-parse.ts";
import { useTypeset } from "./typeset.ts";

// A small markdown reader, so the browser does not get a markdown dependency.
// Keep it in step with `systemPrompt` in assistant-tools.ts: a construct that
// the prompt promises and this file does not know renders as syntax.
//
// It parses the full string again on each streamed delta, so each rule must
// accept a half-arrived string.
//
// A fence tagged `farmer-chart` or `farmer-next` is a directive (a chart, or
// follow-up chips), not markdown. A fence that this file does not know shows
// as a code block. A small model can put a table in a fence or leave the chip
// fence open, so both are accepted.
//
// `streaming` and `reveal` apply only to the turn in flight, because a stored
// thread must not replay. `streaming` shows an open directive fence as a
// placeholder. It is `streaming`, not `closed`, that decides: a stored answer
// with an unclosed fence still shows its chips, and a half chart as code.
// `reveal` fades in each word (`.answer-word` in styles.css,
// `useTypeset` in typeset.ts).

/** The host an `http(s)` link goes to, or null for a path or a `mailto:`.
 *  The label of a link is text the model wrote, so it can name one site and
 *  point at another; the reader needs to see the real destination. */
const externalHost = (href: string) => {
	if (!/^https?:\/\//i.test(href)) return null;
	try {
		return new URL(href).host;
	} catch {
		return null;
	}
};

/** Shared with the tool trace, which prints a month on its own
 *  (`primitives.tsx`). One table, so the two never drift apart. */
export const MONTHS = [
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
export const printDayKey = (day: string) => {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
	if (!match) return null;
	const month = Number(match[2]);
	const date = Number(match[3]);
	if (month < 1 || month > 12 || date < 1 || date > 31) return null;
	return `${date} ${MONTHS[month - 1]}`;
};

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
function DayCitation({ day, reveal }: { day: string; reveal: boolean }) {
	const orgSlug = useOrgSlug();
	const timezone = useRouteContext({
		from: "/$orgSlug",
		select: (context) => context.organization.timezone,
	});
	const today = useToday(timezone);
	const label = printDayKey(day);
	if (!label) return <>{day}</>;
	return (
		<Link
			to="/$orgSlug/time"
			params={{ orgSlug }}
			search={dateSearch(day, today)}
			className={word(reveal, "underlined text-ink")}
		>
			{label}
		</Link>
	);
}

/** How many words a part holds, and never fewer than one.
 *
 *  The floor is there so two adjacent parts cannot share a key: `split` with a
 *  capture group emits an empty string between neighbouring matches, and a part
 *  that is only whitespace holds no words at all. */
const countWords = (part: string) => (part.match(/\S+/g) ?? []).length || 1;

/** `answer-word` on an element that is already one word — a bold run, a date
 *  citation, a link — so it blurs in with the plain words around it instead of
 *  being the one thing on the line that simply appears. */
const word = (reveal: boolean, base: string) =>
	reveal ? `${base} answer-word` : base;

/** One span per word, each blurring in as it mounts. The whitespace that
 *  follows a word rides INSIDE its span: a line still breaks there, and one
 *  element per word is half the nodes of a word plus a separate text node. */
const revealWords = (part: string, at: number) => {
	const words = part.match(/\s*\S+\s*/g);
	if (!words) return part;
	return words.map((token, offset) => (
		<span key={`w${at + offset}`} className="answer-word">
			{token}
		</span>
	));
};

/** Inline `code`, **bold**, *italic*, [links](…) and `[[date]]` citations, in
 *  one pass so none of them can swallow another.
 *
 *  `reveal` wraps each word so it can blur in. It also changes the KEYS, and
 *  that is the load-bearing half: the key below carries the part's own text, so
 *  a part that is still growing changes its own key on each of its first eight
 *  characters, React remounts it, and a CSS animation restarts every time. A
 *  cumulative WORD count is stable instead — a closing `**` that finally lands
 *  re-splits the line around itself without changing how many words are on it,
 *  because the marker's characters belong to the word they are attached to. */
const BR = /<br\s*\/?>\n?/gi;

const renderInline = (text: string, reveal = false) => {
	// Models write `<br>` for a line break. Replace it after the split, so that
	// a `*...*` span over a `<br>` stays one span.
	const parts = text
		.split(
			/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[\[\d{4}-\d{2}-\d{2}\]\]|\[[^\]\n]+\]\([^)\s]+\))/g,
		)
		.map((part) => part.replace(BR, "\n"));
	let cursor = 0;
	return parts.map((part, index) => {
		const at = cursor;
		cursor += countWords(part);
		const key = reveal ? `w${at}` : `${index}-${part.slice(0, 8)}`;
		if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
			return (
				<code
					key={key}
					className={word(
						reveal,
						"rounded-[4px] bg-inset px-1 py-0.5 font-mono text-[12px] text-ink",
					)}
				>
					{part.slice(1, -1)}
				</code>
			);
		}
		if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
			return (
				<strong key={key} className={word(reveal, "font-medium text-ink")}>
					{part.slice(2, -2)}
				</strong>
			);
		}
		if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
			return (
				<em key={key} className={reveal ? "answer-word" : undefined}>
					{part.slice(1, -1)}
				</em>
			);
		}
		const citation = /^\[\[(\d{4}-\d{2}-\d{2})\]\]$/.exec(part);
		if (citation?.[1]) {
			return <DayCitation key={key} day={citation[1]} reveal={reveal} />;
		}
		const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
		if (link) {
			const href = safeHref(link[2] ?? "");
			if (!href) return <Fragment key={key}>{link[1]}</Fragment>;
			const host = externalHost(href);
			return (
				<a
					key={key}
					href={href}
					target="_blank"
					rel="noreferrer noopener"
					title={host ?? undefined}
					className={word(reveal, "underlined text-ink")}
				>
					{link[1]}
					{host && (
						<span className="ml-1 inline-flex items-center gap-0.5 align-baseline text-[11px] text-ink-2 no-underline">
							<ArrowSquareOutIcon aria-hidden="true" size={11} />
							{host}
						</span>
					)}
				</a>
			);
		}
		return (
			<Fragment key={key}>{reveal ? revealWords(part, at) : part}</Fragment>
		);
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
		<div className="-mt-1 flex items-center gap-1 opacity-0 transition-opacity duration-(--dur-base) group-hover/answer:opacity-100 focus-within:opacity-100 md:opacity-0 max-md:opacity-100">
			<button
				type="button"
				onClick={() => void copy()}
				title="Copy this answer"
				aria-label="Copy this answer"
				className="quiet flex items-center gap-1.5 rounded-control px-1.5 py-1 text-[12px] transition-colors duration-(--dur-fast) hover:bg-hover"
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

/** For each block, the text of the heading above it, if any. Names an export. */
const headingBefore = (blocks: Block[]) => {
	let last: string | undefined;
	return blocks.map((block) => {
		if (block.kind === "h") last = block.text;
		return last;
	});
};

export function Answer({
	text,
	onFollowUp,
	reveal = false,
	streaming = false,
}: {
	text: string;
	/** Sends a follow-up chip's prompt as the next message. Absent while a turn
	 *  is in flight, which is what makes the chips inert until it settles. */
	onFollowUp?: (prompt: string) => void;
	/** Blur each word in as it mounts. See the note at the top of this file —
	 *  only the turn in flight sets it. */
	reveal?: boolean;
	/** Whether the answer is still arriving. Only an OPEN directive fence reads
	 *  it, and only to draw itself as a placeholder. */
	streaming?: boolean;
}) {
	if (!text.trim()) return null;
	// A block that arrives whole rather than word by word: a table, a chart, a
	// code block. One fade for the whole thing, because its parts are laid out
	// against each other — a table whose cells blurred in one at a time while its
	// columns were still being measured is a grid of moving text. The block is
	// keyed by its position, so this plays once, on the delta that turned a
	// paragraph into a table, and not again as rows are added under it.
	const blockIn = reveal
		? { animation: "fade-up var(--dur-slow) var(--ease-out) both" }
		: undefined;
	const blocks = parseBlocks(text, streaming);
	const headings = headingBefore(blocks);
	return (
		<div className="flex flex-col gap-2.5 text-[13.5px] leading-relaxed text-ink">
			{blocks.map((block, index) => {
				const key = `${block.kind}-${index}`;
				if (block.kind === "code") {
					return (
						<pre
							key={key}
							style={blockIn}
							className="overflow-auto rounded-control bg-inset p-2.5 font-mono text-[12px] leading-relaxed text-ink-2"
						>
							<code>{block.text}</code>
						</pre>
					);
				}
				if (block.kind === "table") {
					return (
						<div key={key} style={blockIn} className="group/export">
							<AnswerTable
								head={block.head}
								rows={block.rows}
								align={block.align}
							/>
							{!streaming && (
								<TableExport
									head={block.head}
									rows={block.rows}
									title={headings[index]}
								/>
							)}
						</div>
					);
				}
				if (block.kind === "chart") {
					// Same escape as the table's, and the case it exists for is the
					// forty-column trend: at the reading column's width its columns are
					// 8px of bar under a label nobody can read.
					//
					// `FadeSwap` is the crossfade every panel change in the app already
					// uses, and this is one. `mode="wait"` inside it takes the
					// placeholder out BEFORE the chart arrives, so the two are never on
					// screen together claiming to be the same figure. The key is the
					// block's position and does not change when the fence closes — that
					// is what makes this a swap rather than a remount (see `Block` in `answer-parse.ts`).
					return (
						<div key={key} className="answer-wide group/export" style={blockIn}>
							<FadeSwap activeKey={block.spec ? "chart" : "loading"}>
								{block.spec ? (
									<AnswerChart spec={block.spec} />
								) : (
									<ChartPlaceholder outline={block.outline} />
								)}
							</FadeSwap>
							{!streaming && block.spec && <ChartExport spec={block.spec} />}
						</div>
					);
				}
				if (block.kind === "next") {
					// No handler means the turn is still running: render them so the
					// answer doesn't reflow when it settles, but don't offer a click
					// that would abandon the answer being read.
					//
					// An empty list is dropped only once it is READY. Dropped while the
					// fence is still open, a `farmer-next` whose first line has not
					// arrived would have nothing on screen to swap FROM, and the chips
					// would appear rather than cross in.
					if (block.ready && block.prompts.length === 0) return null;
					return (
						<div key={key} className="mt-0.5" style={blockIn}>
							<FadeSwap
								activeKey={block.ready ? "chips" : "loading"}
								className="flex flex-wrap gap-1.5"
							>
								{block.ready ? (
									block.prompts.map((prompt) => (
										<button
											key={prompt}
											type="button"
											disabled={!onFollowUp}
											onClick={() => onFollowUp?.(prompt)}
											className="rounded-control px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 shadow-hairline transition-colors duration-(--dur-fast) enabled:hover:bg-hover enabled:hover:text-ink disabled:opacity-60"
										>
											{prompt}
										</button>
									))
								) : (
									<ChipsPlaceholder count={block.prompts.length} />
								)}
							</FadeSwap>
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
							{renderInline(block.text, reveal)}
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
									<span className="min-w-0">{renderInline(item, reveal)}</span>
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
									<span className="min-w-0">{renderInline(item, reveal)}</span>
								</li>
							))}
						</ul>
					);
				}
				return (
					<p key={key} className="whitespace-pre-wrap">
						{renderInline(block.text, reveal)}
					</p>
				);
			})}
		</div>
	);
}

/**
 * The answer of the turn in flight.
 *
 * Everything that makes a streamed answer read as written rather than as
 * painted is in here, and nothing above the live turn has to know about it:
 * `useTypeset` decides WHEN a word is on screen and `reveal` decides how it
 * arrives. It is a component of its own so the drain's per-frame re-render
 * stops at this subtree instead of running the whole transcript.
 *
 * `.assistant-motion` is the class the reduced-motion block in styles.css ends
 * every animation under. The hook reads the same two settings for the drain, so
 * the pacing and the reveal go together and neither can be left on alone.
 */
export function StreamingAnswer({
	text,
	streaming,
}: {
	text: string;
	streaming: boolean;
}) {
	const visible = useTypeset(text, streaming);
	return (
		<div className="assistant-motion">
			<Answer text={visible} reveal streaming={streaming} />
		</div>
	);
}

/** Cycled rather than randomised, for the reason the chart's are: a random
 *  width is a different width on every streamed delta. */
const CHIP_WIDTHS = ["w-40", "w-32", "w-44", "w-28"];

/**
 * Stands in for the chips while their fence is still open.
 *
 * `count` is how many lines have arrived, so the box grows towards the number
 * of chips it is going to be instead of resizing once at the swap. Two at the
 * least, because a fence that has only just opened has no lines and one pill
 * reads as a chip rather than as a placeholder.
 *
 * `h-8` is the button's own height — 12.5px of text at the answer's
 * `leading-relaxed`, plus `py-1.5` top and bottom. Set by hand because the
 * placeholder has no text in it to be that tall.
 */
function ChipsPlaceholder({ count }: { count: number }) {
	return (
		<>
			{CHIP_WIDTHS.slice(0, Math.min(Math.max(count, 2), 4)).map((width) => (
				<Skeleton key={width} className={`h-8 rounded-control ${width}`} />
			))}
		</>
	);
}
