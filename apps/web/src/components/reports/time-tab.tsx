import {
	formatDecimalHours,
	formatReportHours,
} from "@farmer/core/lib/report-format";
import { resolveReportPeriod } from "@farmer/core/lib/report-period";
import { matchesSearch } from "@farmer/core/lib/search";
import type {
	TimeReportDetailInput,
	TimeReportSummaryInput,
} from "@farmer/core/schema";
import type { TimeReportRow } from "@farmer/core/services";
import { ArrowLeftIcon, XIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Suspense, useState } from "react";

import { PersonCell } from "#/components/person-avatar.tsx";
import { returnLinkClass } from "#/components/time/time-toolbar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { NoMatchesRow, SearchInput } from "#/components/ui/search-input.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { useWeekStartsOn } from "#/hooks/use-week-starts-on.ts";
import { downloadCsv } from "#/lib/csv.ts";
import { heldRoleFrom, projectPageAccess } from "#/lib/project-access.ts";
import { myAccessQuery } from "#/queries/access.ts";
import { clientsQuery } from "#/queries/clients.ts";
import { directoryQuery } from "#/queries/members.ts";
import { projectsQuery } from "#/queries/projects.ts";
import {
	timeReportDetailQuery,
	timeReportSummaryQuery,
} from "#/queries/reports.ts";
import { selectableTasksQuery } from "#/queries/tasks.ts";

import {
	ENTRY_GROUPS,
	EntriesDrilldown,
	EntriesExport,
	EntriesFigure,
	type EntryGroup,
} from "./entries-drilldown.tsx";
import type { Search } from "./search.ts";
import {
	ActiveOnlyToggle,
	byNumber,
	byText,
	FigurePending,
	PeriodPicker,
	QuietTabs,
	type Sort,
	SortHead,
	TabPending,
	toggleSort,
} from "./shared.tsx";

// The Time report (PRD 6.1), laid out the way the COO signed it off against
// Harvest, in two control rows and no more:
//
//   row 1  the period — one stepper with the preset inside it — and, at the
//          right, "Active projects only" and the CSV export;
//   row 2  where you are — on the report, the Clients · Projects · Team tabs
//          with the total at the right; in a drill-down, "← Projects", the
//          thing you opened as the title, and any extra narrowing a link
//          still carries as chips — followed by the table.
//
// The drill-down reads the way Harvest's does: click a project and its people
// appear as summary rows, closed; open one and their entries sit under it.
// Click the hours instead and the same entries come grouped by date. The
// thing you opened is the title — going back is how you drop it — so the
// crumb never repeats a chip. Hours are written the way the accounting book
// writes them (1.821,50).

const GROUPS = [
	{ id: "clients", label: "Clients", noun: "clients" },
	{ id: "projects", label: "Projects", noun: "projects" },
	{ id: "teammates", label: "Team", noun: "people" },
] as const;
type Group = (typeof GROUPS)[number]["id"];

type BreakdownGroup = EntryGroup;

/** The four things a drill-down can be narrowed by, named by their search
 *  param. One of them is the drill-down's subject — the row that was clicked
 *  on the summary tab — and the rest are chips. */
type FilterKind = "client" | "project" | "person" | "task";
const FILTER_KINDS = [
	{ kind: "client", label: "Client" },
	{ kind: "project", label: "Project" },
	{ kind: "person", label: "Person" },
	{ kind: "task", label: "Task" },
] as const satisfies readonly { kind: FilterKind; label: string }[];

/** Which filter a summary tab's rows open, and so what "back" returns to. The
 *  tab stays in the URL across the drill-down for exactly this reason. */
const SUBJECT_OF = {
	clients: { kind: "client", back: "Clients" },
	projects: { kind: "project", back: "Projects" },
	teammates: { kind: "person", back: "Team" },
} as const satisfies Record<Group, { kind: FilterKind; back: string }>;

/** A search patch that sets or clears one filter. A computed key on a union
 *  widens to a string index, which `Search` refuses; the switch keeps it
 *  typed. */
const filterPatch = (
	kind: FilterKind,
	id: string | undefined,
): Partial<Search> => {
	switch (kind) {
		case "client":
			return { client: id };
		case "project":
			return { project: id };
		case "person":
			return { person: id };
		case "task":
			return { task: id };
	}
};

export function TimeTab({
	orgSlug,
	search,
	today,
	thisMonth,
}: {
	orgSlug: string;
	search: Search;
	today: string;
	thisMonth: string;
}) {
	const group: Group = search.group ?? "projects";
	const navigate = useNavigate({ from: "/$orgSlug/reports" });
	const weekStartsOn = useWeekStartsOn();
	const { from, to } = resolveReportPeriod(search, today, weekStartsOn);
	const activeOnly = search.active === "1";
	const drilled = search.view === "breakdown";

	const summaryInput: TimeReportSummaryInput = {
		from,
		to,
		tab: group,
		activeOnly,
	};
	const detailInput: TimeReportDetailInput = {
		from,
		to,
		clientId: search.client,
		projectId: search.project,
		taskId: search.task,
		userId: search.person,
		activeOnly,
	};

	return (
		<>
			<PeriodPicker
				search={search}
				today={today}
				thisMonth={thisMonth}
				link={(s) => (
					<Link to="/$orgSlug/reports" params={{ orgSlug }} search={s} />
				)}
				navigateTo={(s) =>
					navigate({ to: "/$orgSlug/reports", params: { orgSlug }, search: s })
				}
			>
				<ActiveOnlyToggle orgSlug={orgSlug} search={search} />
				<Suspense
					fallback={
						<Button variant="outline" size="sm" disabled>
							Export CSV
						</Button>
					}
				>
					{drilled ? (
						<EntriesExport
							input={detailInput}
							filename={`time-breakdown_${from}_${to}.csv`}
						/>
					) : (
						<SummaryExport input={summaryInput} from={from} to={to} />
					)}
				</Suspense>
			</PeriodPicker>
			{drilled ? (
				<Breakdown orgSlug={orgSlug} search={search} input={detailInput} />
			) : (
				<TimeSummary orgSlug={orgSlug} search={search} input={summaryInput} />
			)}
		</>
	);
}

// ── Level 1: the three tables ──────────────────────────────────────────────

/**
 * The tabs are deliberately *not* inside the boundary their own clicks trip:
 * switching tab changes the query key, and if the control were part of the
 * suspended subtree it would disappear along with the table for as long as
 * the new grouping takes to load. Only the total and the rows are replaced —
 * and they suspend on the same query, so the two boundaries below resolve in
 * the same commit rather than landing one after the other.
 */
function TimeSummary({
	orgSlug,
	search,
	input,
}: {
	orgSlug: string;
	search: Search;
	input: TimeReportSummaryInput;
}) {
	return (
		<>
			<div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
				<QuietTabs
					label="Group by"
					items={GROUPS}
					active={input.tab}
					orgSlug={orgSlug}
					search={(id) => ({ ...search, group: id })}
				/>
				<Suspense fallback={<FigurePending label="Total hours" />}>
					<SummaryFigure input={input} />
				</Suspense>
			</div>

			<Suspense fallback={<TabPending className="mt-6" />}>
				<TimeSummaryRows orgSlug={orgSlug} search={search} input={input} />
			</Suspense>
		</>
	);
}

/** The Team tab's hours are work + time off; the other two tabs never see time
 *  off, which belongs to nobody's client or project. */
const rowHours = (
	row: { secondsTotal: number; timeOffSeconds: number },
	group: Group,
) => row.secondsTotal + (group === "teammates" ? row.timeOffSeconds : 0);

function SummaryFigure({ input }: { input: TimeReportSummaryInput }) {
	const orgSlug = useOrgSlug();
	const { data } = useSuspenseQuery(timeReportSummaryQuery(orgSlug, input));
	const total = data.rows.reduce((sum, r) => sum + rowHours(r, input.tab), 0);
	const noun = GROUPS.find((g) => g.id === input.tab)?.noun ?? "rows";
	return (
		<span className="flex items-baseline gap-2 whitespace-nowrap">
			<span className="eyebrow">Total hours</span>
			<span className="mono text-lg">{formatReportHours(total)}</span>
			<span className="text-xs text-muted-foreground">
				{data.rows.length} {noun}
			</span>
		</span>
	);
}

function SummaryExport({
	input,
	from,
	to,
}: {
	input: TimeReportSummaryInput;
	from: string;
	to: string;
}) {
	const orgSlug = useOrgSlug();
	const { data } = useSuspenseQuery(timeReportSummaryQuery(orgSlug, input));
	return (
		<Button
			variant="outline"
			size="sm"
			disabled={data.rows.length === 0}
			onClick={() =>
				downloadCsv(
					`time-report_${input.tab}_${from}_${to}.csv`,
					input.tab === "teammates"
						? ["Person", "Work", "Time-off", "Hours"]
						: input.tab === "projects"
							? ["Project", "Code", "Client", "People", "Hours"]
							: ["Client", "Projects", "Hours"],
					data.rows.map((r) =>
						input.tab === "teammates"
							? [
									r.name,
									formatDecimalHours(r.secondsTotal),
									formatDecimalHours(r.timeOffSeconds),
									formatDecimalHours(rowHours(r, input.tab)),
								]
							: input.tab === "projects"
								? [
										r.name,
										r.code ?? "",
										r.clientName ?? "",
										String(r.count),
										formatDecimalHours(r.secondsTotal),
									]
								: [r.name, String(r.count), formatDecimalHours(r.secondsTotal)],
					),
				)
			}
		>
			Export CSV
		</Button>
	);
}

/** The hours, as a link into the drill-down, with the bar that answers "who
 *  dominates this period" without reading a number. */
function HoursCell({
	seconds,
	max,
	to,
}: {
	seconds: number;
	max: number;
	to: Search;
}) {
	const orgSlug = useOrgSlug();
	return (
		<span className="flex items-center justify-end gap-3">
			<Link
				to="/$orgSlug/reports"
				params={{ orgSlug }}
				search={to}
				className="mono underlined"
			>
				{formatReportHours(seconds)}
			</Link>
			<span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-secondary">
				<span
					className="block h-full rounded-full bg-primary"
					style={{ width: `${Math.max((seconds / max) * 100, 2)}%` }}
				/>
			</span>
		</span>
	);
}

type SummarySortKey =
	| "name"
	| "client"
	| "count"
	| "work"
	| "timeOff"
	| "hours";

function TimeSummaryRows({
	orgSlug,
	search,
	input,
}: {
	orgSlug: string;
	search: Search;
	input: TimeReportSummaryInput;
}) {
	const group = input.tab;
	const { data } = useSuspenseQuery(timeReportSummaryQuery(orgSlug, input));
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<Sort<SummarySortKey>>({
		key: "hours",
		dir: -1,
	});
	const onSort = (key: SummarySortKey, numeric: boolean) =>
		setSort((current) => toggleSort(current, key, numeric));
	const compare = {
		name: byText((r: TimeReportRow) => r.name),
		client: byText((r: TimeReportRow) => r.clientName),
		count: byNumber((r: TimeReportRow) => r.count),
		work: byNumber((r: TimeReportRow) => r.secondsTotal),
		timeOff: byNumber((r: TimeReportRow) => r.timeOffSeconds),
		hours: byNumber((r: TimeReportRow) => rowHours(r, group)),
	} satisfies Record<
		SummarySortKey,
		(a: TimeReportRow, b: TimeReportRow) => number
	>;

	const rows = data.rows
		.filter((row) => matchesSearch(query, [row.name, row.clientName, row.code]))
		.sort(
			(a, b) =>
				compare[sort.key](a, b) * sort.dir ||
				a.name.localeCompare(b.name, "hr"),
		);
	const max = Math.max(...data.rows.map((r) => rowHours(r, group)), 1);
	const total = data.rows.reduce((sum, r) => sum + rowHours(r, group), 0);

	// Where a click goes. A row's name opens it pre-grouped the way that entity
	// is usually read — except a project, whose name opens its page when the
	// caller has one (Team Lead and up on it) — and the hours open it by date.
	// Only this tab's own filter travels: the row IS the subject.
	const { data: me } = useSuspenseQuery(myAccessQuery(orgSlug));
	const opensPage = (projectId: string) =>
		projectPageAccess(me.isAdmin, heldRoleFrom(me, projectId)).canView;
	const drill = (id: string, by: BreakdownGroup): Search => ({
		...search,
		view: "breakdown",
		client: undefined,
		project: undefined,
		person: undefined,
		task: undefined,
		...filterPatch(SUBJECT_OF[group].kind, id),
		by,
	});
	const openBy: BreakdownGroup =
		group === "clients"
			? "project"
			: group === "projects"
				? "teammate"
				: "project";

	return (
		<>
			{/* Time with no project — synced meetings and fill blocks nobody has
			    filed yet. It cannot appear in the rows below (there is no client or
			    project to group it under) and it is deliberately not added to the
			    total, or the rows would stop summing to the figure above. */}
			{data.unfiledSeconds > 0 && (
				<p className="mt-4 text-sm text-muted-foreground">
					<span className="mono">{formatReportHours(data.unfiledSeconds)}</span>{" "}
					hours in this period aren't filed against any project and are not
					included above.
				</p>
			)}

			{data.rows.length === 0 ? (
				<p className="mt-5 border-t pt-5 text-base text-muted-foreground">
					Nothing logged in this period.
				</p>
			) : (
				<>
					<SearchInput
						value={query}
						onValueChange={setQuery}
						className="mt-4 w-full sm:w-56"
					/>
					<Table containerClassName="mt-3">
						<TableHeader>
							<TableRow>
								<SortHead
									label={
										group === "clients"
											? "Client"
											: group === "projects"
												? "Project"
												: "Name"
									}
									sortKey="name"
									sort={sort}
									onSort={onSort}
								/>
								{group === "clients" && (
									<SortHead
										label="Projects"
										sortKey="count"
										numeric
										sort={sort}
										onSort={onSort}
										className="text-right"
									/>
								)}
								{group === "projects" && (
									<>
										<SortHead
											label="Client"
											sortKey="client"
											sort={sort}
											onSort={onSort}
										/>
										<SortHead
											label="People"
											sortKey="count"
											numeric
											sort={sort}
											onSort={onSort}
											className="text-right"
										/>
									</>
								)}
								{group === "teammates" && (
									<>
										<SortHead
											label="Work"
											sortKey="work"
											numeric
											sort={sort}
											onSort={onSort}
											className="text-right"
										/>
										<SortHead
											label="Time-off"
											sortKey="timeOff"
											numeric
											sort={sort}
											onSort={onSort}
											className="text-right"
										/>
									</>
								)}
								<SortHead
									label="Hours"
									sortKey="hours"
									numeric
									sort={sort}
									onSort={onSort}
									className="text-right"
								/>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.length === 0 ? (
								<NoMatchesRow colSpan={4} />
							) : (
								rows.map((row) => (
									<TableRow key={row.id}>
										<TableCell className="font-medium">
											{group === "projects" && opensPage(row.id) ? (
												<Link
													to="/$orgSlug/projects/$projectId"
													params={{ orgSlug, projectId: row.id }}
													className="underlined"
												>
													{row.code && (
														<span className="mono mr-1.5 text-xs text-muted-foreground">
															[{row.code}]
														</span>
													)}
													{row.name}
													{row.archived && (
														<span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground no-underline">
															archived
														</span>
													)}
												</Link>
											) : (
												<Link
													to="/$orgSlug/reports"
													params={{ orgSlug }}
													search={drill(row.id, openBy)}
													className="underlined"
												>
													{group === "teammates" ? (
														<PersonCell userId={row.id} name={row.name} />
													) : (
														<>
															{row.code && (
																<span className="mono mr-1.5 text-xs text-muted-foreground">
																	[{row.code}]
																</span>
															)}
															{row.name}
															{row.archived && (
																<span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground no-underline">
																	archived
																</span>
															)}
														</>
													)}
												</Link>
											)}
										</TableCell>
										{group === "clients" && (
											<TableCell className="mono text-right text-muted-foreground">
												{row.count}
											</TableCell>
										)}
										{group === "projects" && (
											<>
												<TableCell className="text-muted-foreground">
													{row.clientName}
												</TableCell>
												<TableCell className="mono text-right text-muted-foreground">
													{row.count}
												</TableCell>
											</>
										)}
										{group === "teammates" && (
											<>
												<TableCell className="mono text-right text-muted-foreground">
													{formatReportHours(row.secondsTotal)}
												</TableCell>
												<TableCell className="mono text-right text-muted-foreground">
													{row.timeOffSeconds > 0
														? formatReportHours(row.timeOffSeconds)
														: "—"}
												</TableCell>
											</>
										)}
										<TableCell className="text-right">
											<HoursCell
												seconds={rowHours(row, group)}
												max={max}
												to={drill(row.id, "date")}
											/>
										</TableCell>
									</TableRow>
								))
							)}
							<TableRow className="bg-secondary/60 hover:bg-secondary/60">
								<TableCell className="font-medium">Total</TableCell>
								<TableCell
									colSpan={group === "clients" ? 1 : 2}
									className="mono text-right font-medium"
								>
									{group === "teammates" &&
										formatReportHours(
											data.rows.reduce((sum, r) => sum + r.secondsTotal, 0),
										)}
								</TableCell>
								{group === "teammates" && (
									<TableCell className="mono text-right font-medium">
										{formatReportHours(
											data.rows.reduce((sum, r) => sum + r.timeOffSeconds, 0),
										)}
									</TableCell>
								)}
								<TableCell className="mono text-right font-medium">
									{formatReportHours(total)}
								</TableCell>
							</TableRow>
						</TableBody>
					</Table>
					<p className="mt-3 text-sm text-muted-foreground">
						{group === "projects"
							? "A project opens its page; the hours open its entries by date."
							: "A name opens it by project; the hours open the entries by date."}{" "}
						Time-off is counted in Team only — it belongs to nobody's client.
					</p>
				</>
			)}
		</>
	);
}

// ── Level 2: the drill-down ────────────────────────────────────────────────

/**
 * Every entry behind a number, under the filters in force, grouped one of five
 * ways with the groups closed. The header — back link, subject, chips, the
 * filter picker — and the tools row sit outside the boundary their own
 * controls trip, so narrowing to one task never takes the picker you narrowed
 * with off the screen.
 */
function Breakdown({
	orgSlug,
	search,
	input,
}: {
	orgSlug: string;
	search: Search;
	input: TimeReportDetailInput;
}) {
	const by: BreakdownGroup = search.by ?? "date";
	const group: Group = search.group ?? "projects";
	const subject = SUBJECT_OF[group];
	const navigate = useNavigate({ from: "/$orgSlug/reports" });
	const go = (patch: Partial<Search>) =>
		navigate({
			to: "/$orgSlug/reports",
			params: { orgSlug },
			search: { ...search, ...patch },
		});
	return (
		<>
			<div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
				<Link
					to="/$orgSlug/reports"
					params={{ orgSlug }}
					search={{
						...search,
						view: undefined,
						client: undefined,
						project: undefined,
						task: undefined,
						person: undefined,
						by: undefined,
					}}
					className={`${returnLinkClass} inline-flex items-center gap-1`}
				>
					<ArrowLeftIcon weight="regular" className="size-3.5" />
					{subject.back}
				</Link>
				<Suspense fallback={<Skeleton className="h-5 w-48" />}>
					<DrillHeader
						input={input}
						search={search}
						subject={subject.kind}
						go={go}
					/>
				</Suspense>
				<Suspense
					fallback={<FigurePending label="Total hours" className="ml-auto" />}
				>
					<EntriesFigure input={input} className="ml-auto" />
				</Suspense>
			</div>

			<EntriesDrilldown
				input={input}
				groups={ENTRY_GROUPS.map((g) => g.id)}
				by={by}
				onByChange={(next) => go({ by: next })}
			/>
		</>
	);
}

type EntityName = { label: string; code: string | null; hint: string | null };

/**
 * The names behind the ids in the URL.
 *
 * The org's lists first — cached, every screen reads them — then the
 * entries themselves: a Team Lead's project list holds only their
 * own assignments, while the people they lead log time on projects the lead
 * is not on, and every entry row names its project. Reading the detail here
 * shares the table's query and never suspends, so a chip change swaps the
 * table and leaves this header where it is.
 */
function useEntityNames(input: TimeReportDetailInput) {
	const orgSlug = useOrgSlug();
	const clients = useSuspenseQuery(clientsQuery(orgSlug)).data;
	const projects = useSuspenseQuery(projectsQuery(orgSlug)).data;
	const people = useSuspenseQuery(directoryQuery(orgSlug)).data;
	const tasks = useSuspenseQuery(selectableTasksQuery(orgSlug)).data;
	const detail = useQuery(timeReportDetailQuery(orgSlug, input)).data;
	// Every row shares the filtered ids, so any row names the filtered things.
	const row = detail?.rows[0];

	const nameOf = (kind: FilterKind, id: string): EntityName => {
		switch (kind) {
			case "client": {
				const c = clients.find((c) => c.id === id);
				const label =
					c?.name ?? (row?.clientId === id ? row.clientName : "Client");
				return { label, code: null, hint: null };
			}
			case "project": {
				const p = projects.find((p) => p.id === id);
				if (p) {
					return { label: p.name, code: p.code, hint: p.client?.name ?? null };
				}
				if (row?.projectId === id) {
					return {
						label: row.projectName,
						code: row.projectCode,
						hint: row.clientName,
					};
				}
				return { label: "Project", code: null, hint: null };
			}
			case "person": {
				const m = people.find((m) => m.userId === id);
				const label = m?.name ?? (row?.userId === id ? row.userName : "Person");
				return { label, code: null, hint: null };
			}
			case "task": {
				const t = tasks.find((t) => t.id === id);
				const label = t?.name ?? (row?.taskId === id ? row.taskName : "Task");
				return { label, code: null, hint: null };
			}
		}
	};

	return nameOf;
}

/** The subject as the title, and any extra filter as a chip with an ×. The
 *  subject is not a chip: going back is how you drop it.
 *
 *  There is no control that ADDS a chip. A "+ Filter" picker was built and
 *  taken out again: Group by answers the same questions from the group rows
 *  ("meeting hours on Vinify" is Group by Task, read the Meeting row), and
 *  the one question it doesn't — three dimensions at once — the CSV does.
 *  The chips stay so a link that still carries a filter says so. */
function DrillHeader({
	input,
	search,
	subject,
	go,
}: {
	input: TimeReportDetailInput;
	search: Search;
	subject: FilterKind;
	go: (patch: Partial<Search>) => void;
}) {
	const nameOf = useEntityNames(input);
	const subjectId = search[subject];
	const title = subjectId ? nameOf(subject, subjectId) : null;
	const chips = FILTER_KINDS.filter(
		(k) => k.kind !== subject && search[k.kind],
	);

	return (
		<>
			<span className="flex items-center gap-1.5 text-base font-medium">
				{title === null ? (
					"Everything"
				) : subject === "person" && subjectId ? (
					<PersonCell userId={subjectId} name={title.label} />
				) : (
					<>
						{title.code && (
							<span className="mono text-xs text-muted-foreground">
								[{title.code}]
							</span>
						)}
						{title.label}
						{title.hint && (
							<span className="font-normal text-muted-foreground">
								· {title.hint}
							</span>
						)}
					</>
				)}
			</span>

			{chips.map((k) => {
				const id = search[k.kind];
				if (!id) return null;
				const name = nameOf(k.kind, id);
				return (
					<span
						key={k.kind}
						className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border pr-1 pl-3 text-sm"
					>
						<span className="text-muted-foreground">{k.label}</span>
						<span className="font-medium">
							{name.code ? `[${name.code}] ` : ""}
							{name.label}
						</span>
						<button
							type="button"
							aria-label={`Remove ${k.label.toLowerCase()} filter`}
							onClick={() => go(filterPatch(k.kind, undefined))}
							className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground"
						>
							<XIcon weight="bold" className="size-3" />
						</button>
					</span>
				);
			})}
		</>
	);
}
