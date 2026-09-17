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

import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import { PersonAvatar } from "#/components/person-avatar.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { cn } from "#/lib/utils.ts";
import { clientsQuery } from "#/queries/clients.ts";
import { directoryQuery } from "#/queries/members.ts";
import { projectsQuery } from "#/queries/projects.ts";
import { selectableTasksQuery } from "#/queries/tasks.ts";

import { MONTHS, printDayKey } from "./answer.tsx";
import type { PendingApproval, ToolTrace } from "./assistant-runs.tsx";

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

/** The shimmering label the loader and the trace header share.
 *
 *  The effect itself is `.shimmer-ink` in `styles.css`, because the thread list
 *  wears it too — on the title of any thread with a turn in flight. Only the
 *  size is stated here. */
function ShimmerLabel({ children }: { children: React.ReactNode }) {
	return (
		<span className="shimmer-ink text-[13px] font-medium whitespace-nowrap">
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
		month: z.number().optional(),
		/** `time_report_summary`'s grouping — clients, projects or teammates. */
		tab: z.string().optional(),
		search: z.string().optional(),
		name: z.string().optional(),
		// The four ids a read can be scoped by. Opaque in the payload and the
		// whole point of the lookup below: a uuid in a trace row is noise.
		userId: z.string().optional(),
		projectId: z.string().optional(),
		clientId: z.string().optional(),
		taskId: z.string().optional(),
	})
	.catch({});

export type DetailArgs = z.infer<typeof detailArgs>;

/** One call's arguments, or `{}` for a payload nothing can be read out of. */
export const parseDetailArgs = (raw: string): DetailArgs => {
	try {
		return detailArgs.parse(JSON.parse(raw || "{}"));
	} catch {
		// Only `JSON.parse` reaches here — `.catch({})` above absorbs a payload
		// that parsed but holds nothing this can use.
		return {};
	}
};

/** Id-to-name maps for the four things a step can be scoped to. Missing is the
 *  normal case, not an error: the lists load while the turn is already running,
 *  and a project the caller cannot see was never in them. */
export type TraceNames = {
	people: Map<string, string>;
	projects: Map<string, string>;
	clients: Map<string, string>;
	tasks: Map<string, string>;
};

const EMPTY_NAMES: TraceNames = {
	people: new Map(),
	projects: new Map(),
	clients: new Map(),
	tasks: new Map(),
};

const TAB_WORDING = new Map(
	Object.entries({
		clients: "by client",
		projects: "by project",
		teammates: "by teammate",
	}),
);

export type ToolDetail = {
	/** The person the step was about. Rendered as a face and a name, because a
	 *  column of six "Read the report's entries · 9 Sep – 11 Sep" is six reads
	 *  of six different people and says so nowhere. */
	person: { userId: string; name: string } | null;
	/** Everything else, already worded: a scope, then a range or a day. */
	text: string | null;
};

const EMPTY_DETAIL: ToolDetail = { person: null, text: null };

/**
 * What a step was ABOUT, from the call's own arguments.
 *
 * Four rows reading "Read time entries" say the assistant did something four
 * times and nothing about what, which is exactly the question somebody opens
 * the trace to answer. The arguments already travel with `tool_start`, so the
 * row can name the person, the scope and the range it covered.
 *
 * Decoration, and written as such: anything unreadable gives an empty detail
 * and the row renders as its label alone. The wording lives here beside
 * `toolLabel` rather than in the service, for the same reason that one does.
 * An id whose name has not loaded is left out rather than printed raw — a uuid
 * is worse than nothing in a row this size.
 */
export const toolDetail = (
	args: DetailArgs,
	names: TraceNames = EMPTY_NAMES,
): ToolDetail => {
	const person =
		args.userId && names.people.has(args.userId)
			? {
					userId: args.userId,
					name: names.people.get(args.userId) ?? args.userId,
				}
			: null;

	// Widest scope first, so "Northwind · Atlas Platform" reads the way it is
	// said. At most one of these is set on a real call, but a model may send
	// several and all of them are then true of the step.
	const parts = [
		args.clientId ? names.clients.get(args.clientId) : null,
		args.projectId ? names.projects.get(args.projectId) : null,
		args.taskId ? names.tasks.get(args.taskId) : null,
		args.search ?? args.name ?? null,
	].filter((part): part is string => Boolean(part));

	const when = whenOf(args);

	if (when) parts.push(when);

	if (args.tab) {
		const wording = TAB_WORDING.get(args.tab);

		if (wording) parts.push(wording);
	}

	if (!person && parts.length === 0) return EMPTY_DETAIL;

	return { person, text: parts.length > 0 ? parts.join(" · ") : null };
};

/** The period a call covers, as one phrase. */
const whenOf = (args: DetailArgs): string | null => {
	const from = args.from ? printDayKey(args.from) : null;
	const to = args.to ? printDayKey(args.to) : null;

	if (from && to) return from === to ? from : `${from} – ${to}`;
	const day = args.date ? printDayKey(args.date) : null;

	if (day) return day;

	if (args.year && args.month) {
		return `${MONTHS[args.month - 1] ?? args.month} ${args.year}`;
	}

	return args.year ? String(args.year) : null;
};

// Module scope, not inline arrows: TanStack re-runs `select` whenever the
// function's identity changes (see `person-avatar.tsx` for the same reason).
const byUserId = (rows: { userId: string; name: string }[]) =>
	new Map(rows.map((row) => [row.userId, row.name]));

const byId = (rows: { id: string; name: string }[]) =>
	new Map(rows.map((row) => [row.id, row.name]));

/**
 * The id-to-name maps a set of traces needs, and only those.
 *
 * Each list is fetched only once a trace row actually carries that kind of id,
 * so the common turn — a couple of date ranges — costs no request at all. The
 * directory is the exception in cost rather than in policy: the `/$orgSlug`
 * layout has already warmed it for every avatar on screen.
 */
const useTraceNames = (args: DetailArgs[]): TraceNames => {
	const orgSlug = useOrgSlug();

	const wants = {
		people: args.some((a) => a.userId),
		projects: args.some((a) => a.projectId),
		clients: args.some((a) => a.clientId),
		tasks: args.some((a) => a.taskId),
	};

	const people = useQuery({
		...directoryQuery(orgSlug),
		select: byUserId,
		enabled: wants.people,
	});

	const projects = useQuery({
		...projectsQuery(orgSlug),
		select: byId,
		enabled: wants.projects,
	});

	const clients = useQuery({
		...clientsQuery(orgSlug),
		select: byId,
		enabled: wants.clients,
	});

	const tasks = useQuery({
		...selectableTasksQuery(orgSlug),
		select: byId,
		enabled: wants.tasks,
	});

	return {
		people: people.data ?? EMPTY_NAMES.people,
		projects: projects.data ?? EMPTY_NAMES.projects,
		clients: clients.data ?? EMPTY_NAMES.clients,
		tasks: tasks.data ?? EMPTY_NAMES.tasks,
	};
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

	// Parsed once per trace rather than once per render of each row: the maps
	// below are chosen from these, and the rows are drawn from them again.
	const args = useMemo(
		() => traces.map((trace) => parseDetailArgs(trace.arguments)),
		[traces],
	);

	const names = useTraceNames(args);
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
				className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-(--dur-fast) hover:bg-hover-2"
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
						style={{
							animation: "fade-in var(--dur-slow) var(--ease-out) both",
						}}
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
					className="transition-transform duration-(--dur-fast) ease-(--ease-out)"
					style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
					aria-hidden="true"
				>
					<title>{expanded ? "Collapse" : "Expand"}</title>
					<path d="M6 9l6 6 6-6" />
				</svg>
			</button>

			<div
				// `--dur-long`, not the 400ms this was: a disclosure is a dropdown by
				// another name, and it is clicked repeatedly while reading a turn.
				className="grid transition-[grid-template-rows,opacity] duration-(--dur-long) ease-(--ease-out)"
				style={{
					gridTemplateRows: expanded ? "1fr" : "0fr",
					opacity: expanded ? 1 : 0,
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
								transition: "height var(--dur-long) var(--ease-out)",
							}}
						/>
						<div ref={traceRef} className="flex flex-col gap-1 py-1">
							{traces.map((trace, index) => {
								const detail = toolDetail(args[index] ?? {}, names);

								return (
									<div
										key={trace.toolCallId}
										className="flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left"
										// 40ms a row, capped at the fifth, matching the route
										// cascade in styles.css. At the 120ms step this had, an
										// eight-tool turn was still arriving a second after it
										// opened — and rows keep coming while the answer streams,
										// so the last one was always the one being waited for.
										style={{
											animation: `fade-up var(--dur-slow) var(--ease-out) ${Math.min(index, 4) * 40}ms both`,
										}}
									>
										{trace.ok === null ? (
											// The shared `.spin`, not an inline copy at its own
											// speed: this was a third spinner tempo (700ms beside
											// 900ms and 1s), and because it was inline it was also
											// the one spinner the reduced-motion rules froze solid,
											// which turns "running" and "finished" into the same
											// picture.
											<span className="spin size-3 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-ink-2" />
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
									    when the row runs out of width. The person keeps their
									    face, because a name is what somebody scanning six
									    near-identical rows is looking for. */}
										{detail.person && (
											// Allowed to shrink, unlike the label: a 40-character name
											// beside a long project would otherwise push the row past
											// its own width rather than ellipsize inside it.
											<span className="flex min-w-0 items-center gap-1.5">
												<PersonAvatar
													userId={detail.person.userId}
													name={detail.person.name}
													size="sm"
													className="shrink-0 data-[size=sm]:size-4"
												/>
												<span className="truncate text-[12.5px] text-ink-2">
													{detail.person.name}
												</span>
											</span>
										)}
										{detail.text && (
											<span className="min-w-0 truncate text-[12.5px] text-ink-3">
												{detail.text}
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
			style={{ animation: "fade-up var(--dur-slow) var(--ease-out) both" }}
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
												"border-b border-line2 last:border-0 transition-opacity duration-(--dur-base)",
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
					className="mt-1 w-fit text-[12px] text-ink-3 transition-colors duration-(--dur-fast) hover:text-ink-2"
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
					className="h-7 rounded-control px-2.5 text-[12.5px] font-medium text-ink-2 transition-colors duration-(--dur-fast) enabled:hover:bg-hover enabled:hover:text-ink disabled:opacity-40"
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
						"bg-ink text-surface transition-[opacity,transform] duration-(--dur-base)",
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
