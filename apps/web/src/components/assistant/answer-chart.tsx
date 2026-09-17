// The one shape of UI the assistant can draw that isn't text.
//
// Beautiful UI's Insight Cards are paged agent insights with live charts; this
// is the part of that idea that survives contact with a timesheet. A question
// about one month is a table; a question about twelve is a table nobody reads,
// and the shape of the answer ("March was the outlier") is the answer.
//
// It is deliberately NOT a charting library and not a general one. The model
// emits a fenced `farmer-chart` block holding the JSON below and gets exactly
// two forms back — bars for categories, columns for time. A model that could
// specify axes, scales and series would specify them wrong on the turn nobody
// was checking, and every extra option is a new way for the answer to be
// misleading rather than merely plain.
//
// Where the numbers came from is the model's problem and the table's job; this
// draws what it is handed and labels every bar with its own value, so nothing
// here can only be read off a pixel length.

import { z } from "zod";

import { Skeleton } from "#/components/ui/skeleton.tsx";

/** The JSON inside a ```farmer-chart fence. */
export type ChartSpec = {
	/** `bar` = one row per category, `trend` = columns left to right in time. */
	type: "bar" | "trend";
	title?: string;
	/** Appended to every printed value — "h", "%", "€". Never parsed. */
	unit?: string;
	data: { label: string; value: number }[];
};

/**
 * The fence body's schema.
 *
 * Every field degrades rather than throws where degrading is meaningful: a
 * `type` the model misspelled is a bar chart, a non-string `title` is no title.
 * The data itself does not degrade — a point without a finite number is a bar
 * of NaN width, which is a chart drawn from nonsense, and the caller showing
 * the fence as code is strictly better than that.
 *
 * The 40-row ceiling is there for the same reason the range schemas have one:
 * the model can ask for a chart of 400 days, and the answer is a wall.
 */
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

/** Parses and validates a fence body. Returns null for anything malformed, and
 *  the caller renders the block as code instead — a chart that silently
 *  disappears takes its numbers with it. */
export const parseChartSpec = (source: string): ChartSpec | null => {
	try {
		const parsed = chartSpecSchema.safeParse(JSON.parse(source));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
};

/** Trailing zeros dropped: "7.5h", "8h", not "7.50h". */
const printValue = (value: number, unit?: string) => {
	const rounded = Math.round(value * 100) / 100;
	return `${rounded}${unit ?? ""}`;
};

export function AnswerChart({ spec }: { spec: ChartSpec }) {
	// Bars are drawn against the largest value, not against a fitted scale, and
	// the baseline is zero — a chart whose axis starts at 6.5 makes a 7.5h day
	// look like twice a 7h one. Negative values (a variance chart) are clamped to
	// the baseline rather than mirrored: nothing in this app charts below zero
	// yet, and a half-implemented negative axis is a wrong chart.
	const peak = Math.max(...spec.data.map((point) => Math.abs(point.value)), 0);
	const share = (value: number) =>
		peak === 0 ? 0 : Math.max(0, (value / peak) * 100);

	return (
		<figure className="my-0.5 flex flex-col gap-2">
			{spec.title && <figcaption className="eyebrow">{spec.title}</figcaption>}

			{spec.type === "trend" ? (
				<div className="flex items-end gap-1 overflow-x-auto">
					{spec.data.map((point, index) => (
						<div
							// oxlint-disable-next-line react/no-array-index-key -- re-derived from one string on every streamed delta, so position IS the identity
							key={index}
							className="flex min-w-8 flex-1 flex-col items-center gap-1"
						>
							<span className="text-[11px] text-ink-3 tabular-nums">
								{printValue(point.value, spec.unit)}
							</span>
							{/* The track is the full height so short columns still have
							    something to sit in and the row can't jump as values change. */}
							<div className="flex h-16 w-full items-end rounded-[3px] bg-inset">
								<div
									className="w-full rounded-[3px] bg-chart-1 transition-[height] duration-(--dur-base) ease-(--ease-out)"
									style={{ height: `${Math.max(share(point.value), 2)}%` }}
								/>
							</div>
							<span className="w-full truncate text-center text-[11px] text-ink-3">
								{point.label}
							</span>
						</div>
					))}
				</div>
			) : (
				<div className="flex flex-col gap-1.5">
					{spec.data.map((point, index) => (
						<div
							// oxlint-disable-next-line react/no-array-index-key -- same as above
							key={index}
							className="grid grid-cols-[9rem_1fr_auto] items-center gap-2"
						>
							<span className="truncate text-[12.5px] text-ink-2">
								{point.label}
							</span>
							<span className="h-2.5 rounded-[3px] bg-inset">
								<span
									className="block h-full rounded-[3px] bg-chart-1 transition-[width] duration-(--dur-base) ease-(--ease-out)"
									style={{ width: `${Math.max(share(point.value), 1)}%` }}
								/>
							</span>
							<span className="text-[12.5px] text-ink tabular-nums">
								{printValue(point.value, spec.unit)}
							</span>
						</div>
					))}
				</div>
			)}
		</figure>
	);
}

/* ── the placeholder ───────────────────────────────────────────────────────── */

/**
 * The shape a chart is going to be, read off the JSON that has arrived so far.
 *
 * A `farmer-chart` fence cannot be drawn until it CLOSES — half a JSON object
 * parses as nothing — and what the reader used to get in the meantime was the
 * raw object in a code block, replaced by the chart on the last token. So the
 * fence renders as a box instead, and the box is worth sizing: a placeholder
 * that lands at the chart's own height does not move the text under it when the
 * two swap.
 *
 * Three regexes rather than a tolerant JSON parser, and they are allowed to be
 * wrong. Every one of them is answering a question about a box nobody will look
 * at for more than a second, and a partial object is not a document any parser
 * can be right about.
 */
export type ChartOutline = {
	type: "bar" | "trend";
	rows: number;
	titled: boolean;
};

export const outlineChart = (body: string): ChartOutline => ({
	type: /"type"\s*:\s*"trend"/.test(body) ? "trend" : "bar",
	// Three at the least, so a fence that has only just opened is still a box
	// and not a hairline. Twelve at the most, for the reason the spec's own
	// ceiling is 40: a placeholder as tall as the screen is a wall.
	rows: Math.min(Math.max((body.match(/"label"\s*:/g) ?? []).length, 3), 12),
	titled: /"title"\s*:/.test(body),
});

/** Widths cycled rather than randomised: a random width is a different width on
 *  every streamed delta, which is a placeholder that twitches. */
const LABEL_WIDTHS = ["w-24", "w-16", "w-28", "w-20", "w-14"];
const BAR_SHARES = [82, 54, 96, 38, 67, 74, 45, 88];

const pick = <T,>(table: readonly T[], index: number, fallback: T) =>
	table[index % table.length] ?? fallback;

/**
 * A slot the height of one line of the chart's own text, holding a bar the
 * height of the ink in it.
 *
 * The chart labels its every value, so a row of it is as tall as a line of
 * 12.5px text under the answer's `leading-relaxed` and not as tall as the 2.5px
 * bar beside it. A placeholder built out of bare skeletons is a third shorter
 * than the chart it stands in for, and the text under the two of them steps
 * down when they swap — which is the one thing sizing the box was for.
 */
function TextSlot({ className }: { className: string }) {
	// A div and not a span, here and on the bar's own track below: `Skeleton`
	// renders a div, and a div inside a span is a nesting the browser repairs
	// during hydration rather than accepting.
	return (
		<div className="flex h-5 items-center">
			<Skeleton className={`h-2.5 rounded-[3px] ${className}`} />
		</div>
	);
}

/** Stands in for a chart whose fence has not closed yet. Same frame, same
 *  metrics, same tokens — see `ChartOutline` for why it is worth the trouble. */
export function ChartPlaceholder({ outline }: { outline: ChartOutline }) {
	const rows = Array.from({ length: outline.rows }, (_, index) => index);
	return (
		<div aria-hidden className="my-0.5 flex flex-col gap-2">
			{outline.titled && <TextSlot className="w-32" />}

			{outline.type === "trend" ? (
				// `overflow-hidden` where the chart has `overflow-x-auto`: the real one
				// may be scrolled sideways and this one has nothing to scroll to, and a
				// scrollbar that appears under the placeholder and goes at the swap is
				// movement at the bottom of the figure.
				<div className="flex items-end gap-1 overflow-hidden">
					{rows.map((index) => (
						<div
							key={index}
							className="flex min-w-8 flex-1 flex-col items-center gap-1"
						>
							<TextSlot className="w-6" />
							<div className="flex h-16 w-full items-end rounded-[3px] bg-inset">
								<Skeleton
									className="w-full rounded-[3px]"
									style={{ height: `${pick(BAR_SHARES, index, 60)}%` }}
								/>
							</div>
							<TextSlot className="w-8" />
						</div>
					))}
				</div>
			) : (
				<div className="flex flex-col gap-1.5">
					{rows.map((index) => (
						<div
							key={index}
							className="grid grid-cols-[9rem_1fr_auto] items-center gap-2"
						>
							<TextSlot className={pick(LABEL_WIDTHS, index, "w-20")} />
							<div className="h-2.5 rounded-[3px] bg-inset">
								<Skeleton
									className="h-full rounded-[3px]"
									style={{ width: `${pick(BAR_SHARES, index, 60)}%` }}
								/>
							</div>
							<TextSlot className="w-8" />
						</div>
					))}
				</div>
			)}
		</div>
	);
}
