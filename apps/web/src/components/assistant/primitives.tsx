// Ported from Beautiful UI (beautifului.dev, MIT © 2026 Shane Levine).
//
// The originals are self-running demos: hardcoded data, a `posthog-js` import,
// and `useState` timelines that drive themselves so the marketing page has
// something to watch. What survives the port is the markup, the motion and the
// proportions; the demo state is replaced by props fed from the real stream, and
// the token names (`bg-surface`, `text-ink-2`, `shadow-card`) resolve through
// the alias layer in `styles.css` onto this app's own palette — so they inherit
// the warm paper and dark mode instead of arriving as a second design system.
//
// Sources: LoadingState.tsx, ThinkingState.tsx, ApprovalCard.tsx.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";

import { cn } from "#/lib/utils.ts";

import { printDayKey } from "./answer.tsx";
import type { PendingApproval, ToolTrace } from "./use-assistant-stream.ts";

/* ── the pixel-grid loader (LoadingState) ─────────────────────────────────── */

// A chevron wavefront: cell delay grows with the column and with distance from
// the middle row, so the front reads as driving rightwards. The 650ms cycle is
// shorter than the sweep across the grid, so two fronts are always in flight.
const CHEVRON = Array.from({ length: 9 }, (_, i) => {
	const row = Math.floor(i / 3);
	const column = i % 3;
	return (column + Math.abs(row - 1)) * 90;
});

function LoaderGrid() {
	return (
		<span
			aria-hidden
			className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]"
		>
			{CHEVRON.map((delay, index) => (
				<span
					// oxlint-disable-next-line react/no-array-index-key -- a fixed 3x3 grid
					key={index}
					className="size-[4px] rounded-[1px] bg-ink"
					style={{
						opacity: 0.15,
						animation: `pixel-on 650ms ease-in-out ${delay}ms infinite`,
					}}
				/>
			))}
		</span>
	);
}

/** Counts in tenths so the figure moves visibly without a per-frame render. */
function useElapsed(active: boolean) {
	const [tenths, setTenths] = useState(0);
	useEffect(() => {
		if (!active) return;
		setTenths(0);
		const timer = setInterval(() => setTenths((current) => current + 1), 100);
		return () => clearInterval(timer);
	}, [active]);
	const total = tenths / 10;
	if (total < 60) return `${total.toFixed(1)}s`;
	return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

/** The shimmering label the loader and the trace header share. */
function ShimmerLabel({ children }: { children: React.ReactNode }) {
	return (
		<span
			className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
			style={{
				backgroundImage:
					"linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
				backgroundSize: "200% 100%",
				animation: "shimmer-text 1.4s linear infinite",
			}}
		>
			{children}
		</span>
	);
}

export function AssistantLoader({ label = "Thinking" }: { label?: string }) {
	const elapsed = useElapsed(true);
	// `<output>` rather than a div with role="status": it carries the live region
	// natively, so a screen reader announces the label without the role having to
	// be maintained by hand.
	return (
		<output className="assistant-motion flex w-fit items-center gap-2.5">
			<LoaderGrid />
			<ShimmerLabel>{label}</ShimmerLabel>
			<span className="font-mono text-[12px] text-ink-3 tabular-nums">
				{elapsed}
			</span>
		</output>
	);
}

/* ── the tool trace (ThinkingState, "Coding" variant) ─────────────────────── */

// Written as the step reads in a trace, not as the tool is named: "Read time
// entries", not "list_time_entries". Unlabelled tools fall back to their name
// with the underscores taken out, which is legible but reads as plumbing — so a
// tool added to `assistant-tools.ts` belongs here too.
// A Map, not an object: the lookup key is a tool name off a stored transcript,
// so `get` answering `string | undefined` is the honest contract — an object
// would have to claim every string is a key.
const TOOL_LABELS = new Map(
	Object.entries({
		// reads
		whoami: "Checked who you are",
		list_time_entries: "Read time entries",
		list_unfiled_entries: "Read unfiled time",
		list_projects: "Read projects",
		list_tasks: "Read tasks",
		list_clients: "Read clients",
		list_members: "Read the team",
		list_project_members: "Read a project's team",
		list_holidays: "Checked the holidays",
		list_recurring_block_rules: "Read your recurring blocks",
		list_commits: "Read your commits",
		list_pull_requests: "Read your pull requests",
		suggest_day: "Assembled the day",
		time_report_summary: "Ran a time report",
		time_report_detail: "Read the report's entries",
		overtime_report: "Ran the overtime report",
		unfiled_summary: "Checked unfiled time",
		absence_totals: "Checked absence taken",
		list_absences: "Read absence entries",
		absence_report: "Ran the absence report",
		// writes
		create_time_entry: "Log time",
		update_time_entry: "Change an entry",
		update_entry_description: "Reword an entry",
		set_overtime: "Flag overtime",
		file_time_entries: "File entries onto a project",
		copy_day: "Copy a day",
		copy_week: "Copy a week",
		log_absence: "Book absence",
		apply_day_assembly: "Log the day's entries",
		attach_commits: "Attach commits",
		attach_pull_requests: "Attach pull requests",
		create_client: "Create a client",
		create_project: "Create a project",
		update_project: "Change a project",
		assign_project_member: "Change a project's team",
		create_task: "Create a task type",
		update_task: "Change a task type",
		create_recurring_block_rule: "Create a recurring block",
		update_recurring_block_rule: "Change a recurring block",
		unarchive: "Restore from the archive",
		// destructive
		delete_time_entry: "Delete an entry",
		remove_absence: "Delete an absence entry",
		delete_recurring_block_rule: "Delete a recurring block",
		archive_project: "Archive a project",
		archive_client: "Archive a client",
		archive_task: "Archive a task type",
	}),
);

export const toolLabel = (name: string) =>
	TOOL_LABELS.get(name) ?? name.replaceAll("_", " ");

/**
 * The arguments a trace row can say something about.
 *
 * PARSED rather than narrowed by hand, because this reads a payload a language
 * model wrote: every field is optional, an argument of the wrong type is not a
 * field this can use, and `.catch({})` makes a malformed call a row with no
 * subject instead of a crash inside the transcript.
 */
const detailArgs = z
	.object({
		date: z.string().optional(),
		from: z.string().optional(),
		to: z.string().optional(),
		year: z.number().optional(),
		groupBy: z.string().optional(),
		search: z.string().optional(),
		name: z.string().optional(),
	})
	.catch({});

/**
 * What a step was ABOUT, from the call's own arguments.
 *
 * Four rows reading "Read time entries" say the assistant did something four
 * times and nothing about what, which is exactly the question somebody opens
 * the trace to answer. The arguments already travel with `tool_start`, so the
 * row can name the range or the day it covered.
 *
 * Decoration, and written as such: anything unreadable gives null and the row
 * renders as its label alone. The wording lives here beside `toolLabel` rather
 * than in the service, for the same reason that one does.
 */
export const toolDetail = (raw: string): string | null => {
	let args: z.infer<typeof detailArgs>;
	try {
		args = detailArgs.parse(JSON.parse(raw || "{}"));
	} catch {
		// Only `JSON.parse` reaches here — `.catch({})` above absorbs a payload
		// that parsed but holds nothing this can use.
		return null;
	}
	const from = args.from ? printDayKey(args.from) : null;
	const to = args.to ? printDayKey(args.to) : null;
	if (from && to) return from === to ? from : `${from} – ${to}`;
	const day = args.date ? printDayKey(args.date) : null;
	if (day) return day;
	if (args.year) return String(args.year);
	if (args.groupBy) return `by ${args.groupBy.replaceAll("_", " ")}`;
	return args.search ?? args.name ?? null;
};

/**
 * The expandable trace of what the assistant did to answer.
 *
 * Auto-expands while it is working and collapses once settled, which is the
 * original's behaviour and the right default: the steps are interesting while
 * they are happening and clutter afterwards. Manual toggling wins from then on.
 */
export function ToolTraceList({
	traces,
	working,
}: {
	traces: ToolTrace[];
	working: boolean;
}) {
	const [manual, setManual] = useState<boolean | null>(null);
	const expanded = manual ?? working;
	const traceRef = useRef<HTMLDivElement>(null);
	const [lineHeight, setLineHeight] = useState(0);

	// The vertical rule beside the steps is drawn to the measured height of the
	// list rather than stretched by the layout, so it animates with the rows
	// rather than snapping to its final length on the first frame.
	// oxlint-disable-next-line react-hooks/exhaustive-deps -- it measures the rendered list, so the deps are exactly what changes that list's height
	useLayoutEffect(() => {
		if (traceRef.current) setLineHeight(traceRef.current.offsetHeight);
	}, [traces.length, expanded]);

	if (traces.length === 0) return null;

	const done = traces.filter((trace) => trace.ok !== null).length;

	return (
		<div className="assistant-motion flex w-full flex-col">
			<button
				type="button"
				aria-expanded={expanded}
				onClick={() => setManual((current) => !(current ?? working))}
				className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-100 hover:bg-hover-2"
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill={working ? "var(--ink-2)" : "var(--ink-3)"}
					aria-hidden="true"
				>
					<title>Trace</title>
					<path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
				</svg>
				{working ? (
					<ShimmerLabel>Working</ShimmerLabel>
				) : (
					<span
						className="text-[13px] font-medium whitespace-nowrap text-ink-2"
						style={{ animation: "fade-in 350ms ease-out both" }}
					>
						{done === 1 ? "Used 1 tool" : `Used ${done} tools`}
					</span>
				)}
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="var(--ink-3)"
					strokeWidth="2.2"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="transition-transform duration-300"
					style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
					aria-hidden="true"
				>
					<title>{expanded ? "Collapse" : "Expand"}</title>
					<path d="M6 9l6 6 6-6" />
				</svg>
			</button>

			<div
				className="grid transition-[grid-template-rows,opacity] duration-400"
				style={{
					gridTemplateRows: expanded ? "1fr" : "0fr",
					opacity: expanded ? 1 : 0,
					transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
				}}
			>
				<div className="overflow-hidden">
					<div className="relative mt-1 ml-[5px] pl-4">
						<span
							aria-hidden
							className="absolute left-[3px] w-px bg-line"
							style={{
								top: -8,
								height: lineHeight ? lineHeight - 2 : 0,
								transition: "height 500ms cubic-bezier(0.23,1,0.32,1)",
							}}
						/>
						<div ref={traceRef} className="flex flex-col gap-1 py-1">
							{traces.map((trace, index) => {
								const detail = toolDetail(trace.arguments);
								return (
									<div
										key={trace.toolCallId}
										className="flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left"
										style={{
											animation: `fade-up 320ms cubic-bezier(0.23,1,0.32,1) ${index * 120}ms both`,
										}}
									>
										{trace.ok === null ? (
											<span
												className="size-3 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-ink-2"
												style={{ animation: "spin 700ms linear infinite" }}
											/>
										) : (
											<svg
												width="14"
												height="14"
												viewBox="0 0 24 24"
												fill="none"
												stroke={trace.ok ? "var(--ink-3)" : "var(--orange)"}
												strokeWidth="2.5"
												strokeLinecap="round"
												strokeLinejoin="round"
												className="shrink-0"
												aria-hidden="true"
											>
												<title>{trace.ok ? "Done" : "Failed"}</title>
												{trace.ok ? (
													<path d="M20 6L9 17l-5-5" />
												) : (
													<path d="M18 6L6 18M6 6l12 12" />
												)}
											</svg>
										)}
										<span className="shrink-0 text-[12.5px] font-medium text-ink">
											{toolLabel(trace.name)}
										</span>
										{/* The subject, dimmer and second: the step is what happened
									    and this is what it happened to, so it truncates first
									    when the row runs out of width. */}
										{detail && (
											<span className="min-w-0 truncate text-[12.5px] text-ink-3">
												{detail}
											</span>
										)}
									</div>
								);
							})}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

/* ── the approval card (ApprovalCard) ─────────────────────────────────────── */

/** Pretty-prints the tool arguments for the disclosure, falling back to the raw
 *  string — a model can emit malformed JSON, and showing it is more useful than
 *  showing nothing when somebody is deciding whether to let it run. */
const formatArgs = (raw: string) => {
	try {
		return JSON.stringify(JSON.parse(raw || "{}"), null, 2);
	} catch {
		return raw;
	}
};

/**
 * The one gate between the model asking to write and the write happening.
 *
 * The summary is built from the ARGUMENTS server-side (assistant-tools.ts), not
 * from the tool name: "create a time entry" is not something anyone can
 * meaningfully consent to, whereas "Log 2.00h on 2026-03-03 — code review" is.
 */
export function ApprovalCard({
	pending,
	busy,
	onDecide,
}: {
	pending: PendingApproval;
	busy: boolean;
	onDecide: (
		decision: "approved" | "rejected",
		selectedRowIds?: string[],
	) => void;
}) {
	const [showArgs, setShowArgs] = useState(false);
	const rows = pending.preview?.rows ?? [];
	const selectable = pending.selectable && rows.length > 0;

	// Everything starts ticked. The model proposed these rows and the person
	// asked for the batch, so the default has to be "all of it" — a card that
	// opens with nothing selected turns one decision back into fifteen.
	const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
	// Re-arming when a DIFFERENT batch arrives; keyed on the call id rather than
	// the rows, so a re-render can't quietly re-tick something the person just
	// unticked.
	const armedFor = useRef(pending.toolCallId);
	if (armedFor.current !== pending.toolCallId) {
		armedFor.current = pending.toolCallId;
		setExcluded(new Set());
	}

	const selected = rows.map((row) => row.id).filter((id) => !excluded.has(id));
	const toggle = (id: string) =>
		setExcluded((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	const approve = () => onDecide("approved", selectable ? selected : undefined);
	// A capped preview: rows past the cap are not on the card, cannot be
	// unticked, and go through with the approval (the note says so). The count
	// and the button therefore speak about what is SHOWN and what is left out,
	// because "Do these 24" over a 40-row batch would promise 24 and write 39.
	const hasHiddenRows = Boolean(pending.preview?.note);
	const unticked = rows.length - selected.length;

	return (
		<div
			className={cn(
				"assistant-motion w-full overflow-hidden rounded-card bg-surface shadow-card",
				// A yes/no card stays narrow; a table needs the column width, and a
				// 25rem card with four columns in it is four columns of ellipsis.
				rows.length > 0 ? "max-w-[36rem]" : "max-w-100",
			)}
			style={{ animation: "fade-up 350ms cubic-bezier(0.23,1,0.32,1) both" }}
		>
			<div className="flex flex-col gap-1 px-3.5 pt-3 pb-2.5">
				<span className="text-2xs font-medium tracking-wide text-ink-3 uppercase">
					Needs your approval
				</span>
				<span className="text-[13px] font-medium text-ink">
					{pending.summary}
				</span>

				{pending.preview && rows.length > 0 && (
					<div className="mt-1.5 -mx-1 overflow-x-auto">
						<table className="w-full border-collapse text-[12.5px]">
							<thead>
								<tr className="border-b border-line">
									{selectable && <th className="w-7 px-1 py-1.5" />}
									{pending.preview.columns.map((column) => (
										<th
											key={column}
											className="eyebrow px-1.5 py-1.5 text-left align-bottom"
										>
											{column}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{rows.map((row) => {
									const on = !excluded.has(row.id);
									return (
										<tr
											key={row.id}
											className={cn(
												"border-b border-line2 last:border-0 transition-opacity duration-150",
												// An unticked row stays legible rather than
												// disappearing: it is still part of what was proposed,
												// and the person needs to see what they turned off.
												on ? "opacity-100" : "opacity-45",
											)}
										>
											{selectable && (
												<td className="px-1 py-1.5 align-top">
													<input
														type="checkbox"
														checked={on}
														disabled={busy}
														onChange={() => toggle(row.id)}
														aria-label={`Include ${row.cells[0] ?? "this row"}`}
														className="size-3.5 accent-[var(--ink)]"
													/>
												</td>
											)}
											{row.cells.map((cell, index) => (
												<td
													// oxlint-disable-next-line react/no-array-index-key -- a fixed column order — position IS the column
													key={index}
													className={cn(
														"px-1.5 py-1.5 align-top",
														index === 0 ? "text-ink" : "text-ink-2",
														// Only the last column is allowed to wrap; the rest
														// are dates, hours and names that read worse broken.
														index === row.cells.length - 1
															? "min-w-40"
															: "whitespace-nowrap",
													)}
												>
													{cell}
												</td>
											))}
										</tr>
									);
								})}
							</tbody>
						</table>
						{pending.preview.note && (
							<p className="mt-1.5 px-1.5 text-[11.5px] text-ink-3">
								{pending.preview.note}
							</p>
						)}
					</div>
				)}

				<button
					type="button"
					onClick={() => setShowArgs((current) => !current)}
					className="mt-1 w-fit text-[12px] text-ink-3 transition-colors duration-100 hover:text-ink-2"
				>
					{showArgs ? "Hide details" : "Show details"}
				</button>
				{showArgs && (
					<pre className="mt-1 max-h-48 overflow-auto rounded-control bg-inset p-2 font-mono text-[11px] leading-relaxed text-ink-2">
						{formatArgs(pending.arguments)}
					</pre>
				)}
			</div>
			<div className="flex items-center justify-end gap-2 border-t border-line px-3.5 py-2">
				{selectable && (
					// The count is the answer to "what am I actually agreeing to" once
					// boxes have been unticked, so it sits beside the button that does it.
					<span className="mr-auto text-[12px] text-ink-3">
						{selected.length} of {rows.length}
						{hasHiddenRows ? " shown" : ""} selected
					</span>
				)}
				<button
					type="button"
					disabled={busy}
					onClick={() => onDecide("rejected")}
					className="h-7 rounded-control px-2.5 text-[12.5px] font-medium text-ink-2 transition-colors duration-100 enabled:hover:bg-hover enabled:hover:text-ink disabled:opacity-40"
				>
					Don't
				</button>
				<button
					type="button"
					// Nothing ticked is not a write, so the button that writes says so
					// rather than sending an empty batch for the server to reinterpret.
					disabled={busy || (selectable && selected.length === 0)}
					onClick={approve}
					className={cn(
						"flex h-7 items-center gap-1.5 rounded-control px-3 text-[12.5px] font-medium",
						"bg-ink text-surface transition-[opacity,transform] duration-150",
						"enabled:active:scale-[0.97] disabled:opacity-40",
					)}
				>
					{!selectable || unticked === 0
						? "Do it"
						: hasHiddenRows
							? `Do all but ${unticked}`
							: `Do these ${selected.length}`}
				</button>
			</div>
		</div>
	);
}
