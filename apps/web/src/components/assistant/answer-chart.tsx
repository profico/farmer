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

/** The JSON inside a ```farmer-chart fence. */
export type ChartSpec = {
	/** `bar` = one row per category, `trend` = columns left to right in time. */
	type: "bar" | "trend";
	title?: string;
	/** Appended to every printed value — "h", "%", "€". Never parsed. */
	unit?: string;
	data: { label: string; value: number }[];
};

/** Parses and validates a fence body. Returns null for anything malformed, and
 *  the caller renders the block as code instead — a chart that silently
 *  disappears takes its numbers with it. */
export const parseChartSpec = (source: string): ChartSpec | null => {
	let raw: unknown;
	try {
		raw = JSON.parse(source);
	} catch {
		return null;
	}
	if (!raw || typeof raw !== "object") return null;
	const candidate = raw as Record<string, unknown>;
	const type = candidate.type === "trend" ? "trend" : "bar";
	if (!Array.isArray(candidate.data) || candidate.data.length === 0)
		return null;
	const data: ChartSpec["data"] = [];
	for (const point of candidate.data) {
		if (!point || typeof point !== "object") return null;
		const { label, value } = point as Record<string, unknown>;
		// A non-finite value would render as a NaN-wide bar — a chart drawn from
		// nonsense, which is worse than the fence showing as text.
		if (typeof label !== "string" || typeof value !== "number") return null;
		if (!Number.isFinite(value)) return null;
		data.push({ label, value });
	}
	// A ceiling on the number of rows, for the same reason the range schemas have
	// one: the model can ask for a chart of 400 days and the answer is a wall.
	if (data.length > 40) return null;
	return {
		type,
		title: typeof candidate.title === "string" ? candidate.title : undefined,
		unit: typeof candidate.unit === "string" ? candidate.unit : undefined,
		data,
	};
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
							// biome-ignore lint/suspicious/noArrayIndexKey: re-derived from one string on every streamed delta, so position IS the identity
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
									className="w-full rounded-[3px] bg-chart-1 transition-[height] duration-300"
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
							// biome-ignore lint/suspicious/noArrayIndexKey: same as above
							key={index}
							className="grid grid-cols-[9rem_1fr_auto] items-center gap-2"
						>
							<span className="truncate text-[12.5px] text-ink-2">
								{point.label}
							</span>
							<span className="h-2.5 rounded-[3px] bg-inset">
								<span
									className="block h-full rounded-[3px] bg-chart-1 transition-[width] duration-300"
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
