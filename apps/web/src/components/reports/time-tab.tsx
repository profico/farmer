import {
	formatDecimalHours,
	formatReportHours,
} from "@farmer/core/lib/report-format";
import { resolveReportPeriod } from "@farmer/core/lib/report-period";
import type {
	TimeReportDetailInput,
	TimeReportSummaryInput,
} from "@farmer/core/schema";
import {
	ArrowLeftIcon,
	CaretDownIcon,
	CaretUpIcon,
} from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Fragment, Suspense, useState } from "react";

import { PersonCell } from "#/components/person-avatar.tsx";
import { returnLinkClass } from "#/components/time/time-toolbar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { NoMatchesRow, SearchInput } from "#/components/ui/search-input.tsx";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/ui/segmented-control.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { downloadCsv } from "#/lib/csv.ts";
import { matchesSearch } from "#/lib/search.ts";
import { cn } from "#/lib/utils.ts";
import { clientsQuery } from "#/queries/clients.ts";
import { directoryQuery } from "#/queries/members.ts";
import { projectsQuery } from "#/queries/projects.ts";
import {
	timeReportDetailQuery,
	timeReportSummaryQuery,
} from "#/queries/reports.ts";
import { selectableTasksQuery } from "#/queries/tasks.ts";

import type { Search } from "./search.ts";
import { formatDateHeading, PeriodPicker, TabPending } from "./shared.tsx";

// The Time report (PRD 6.1), as the COO signed it off against Harvest: a total
// for the period, then Clients · Projects · Team, each a sortable table with an
// hours bar; a name opens the Breakdown pre-grouped, the hours open it by
// date. The Breakdown is the entries behind a number under up to four filters,
// grouped by any of five keys, with the group's sum on its header row. Hours
// are written the way the accounting book writes them (1.821,50).

/** The placeholder for a single figure — a total or a percentage — that sits in
 *  a row of controls. The label stays: only the number is unknown. */
function FigurePending({
	label,
	className,
}: {
	label: string;
	className?: string;
}) {
	return (
		<span
			className={cn("flex items-baseline gap-2 whitespace-nowrap", className)}
		>
			<span className="eyebrow">{label}</span>
			<Skeleton className="h-4 w-16" />
		</span>
	);
}

const GROUPS = [
	{ id: "clients", label: "Clients" },
	{ id: "projects", label: "Projects" },
	{ id: "teammates", label: "Team" },
] as const;
type Group = (typeof GROUPS)[number]["id"];

const BREAKDOWN_GROUPS = [
	{ id: "client", label: "Client" },
	{ id: "project", label: "Project" },
	{ id: "task", label: "Task" },
	{ id: "teammate", label: "Teammate" },
	{ id: "date", label: "Date" },
] as const;
type BreakdownGroup = (typeof BREAKDOWN_GROUPS)[number]["id"];

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
	const { from, to } = resolveReportPeriod(search, today);
	const activeOnly = search.active === "1";

	if (search.view === "breakdown") {
		return (
			<>
				<PeriodPicker
					orgSlug={orgSlug}
					search={search}
					today={today}
					thisMonth={thisMonth}
				>
					<ActiveOnlyToggle orgSlug={orgSlug} search={search} />
				</PeriodPicker>
				<Breakdown
					orgSlug={orgSlug}
					search={search}
					from={from}
					to={to}
					activeOnly={activeOnly}
				/>
			</>
		);
	}

	return (
		<>
			<PeriodPicker
				orgSlug={orgSlug}
				search={search}
				today={today}
				thisMonth={thisMonth}
			>
				<ActiveOnlyToggle orgSlug={orgSlug} search={search} />
			</PeriodPicker>
			<TimeSummary
				orgSlug={orgSlug}
				search={search}
				group={group}
				from={from}
				to={to}
				activeOnly={activeOnly}
			/>
		</>
	);
}

/** "Active projects only" — leaves archived projects' time out of every figure
 *  on the screen. In the URL like every other report control, so a shared link
 *  shows what its sender saw. */
function ActiveOnlyToggle({
	orgSlug,
	search,
}: {
	orgSlug: string;
	search: Search;
}) {
	const navigate = useNavigate({ from: "/$orgSlug/reports" });
	const on = search.active === "1";
	return (
		<span className="flex items-center gap-2 text-sm text-muted-foreground">
			<Switch
				size="sm"
				aria-label="Active projects only"
				checked={on}
				onCheckedChange={(checked) =>
					navigate({
						to: "/$orgSlug/reports",
						params: { orgSlug },
						search: { ...search, active: checked ? "1" : undefined },
					})
				}
			/>
			Active projects only
		</span>
	);
}

// ── Level 1: the three tables ──────────────────────────────────────────────

/**
 * The grouping control is deliberately *not* inside the boundary that its own
 * clicks trip: switching group changes the query key, and if the control were
 * part of the suspended subtree it would disappear along with the table for as
 * long as the new grouping takes to load. Only the total and the rows are
 * replaced — and they suspend on the same query, so the two boundaries below
 * resolve in the same commit rather than landing one after the other.
 */
function TimeSummary({
	orgSlug,
	search,
	group,
	from,
	to,
	activeOnly,
}: {
	orgSlug: string;
	search: Search;
	group: Group;
	from: string;
	to: string;
	activeOnly: boolean;
}) {
	const input: TimeReportSummaryInput = { from, to, tab: group, activeOnly };
	return (
		<>
			<div className="mt-6 flex flex-wrap items-center justify-between gap-3">
				<SegmentedControl>
					{GROUPS.map((g) => (
						<SegmentedControlItem
							key={g.id}
							active={group === g.id}
							render={
								<Link
									to="/$orgSlug/reports"
									params={{ orgSlug }}
									search={{ ...search, group: g.id }}
								/>
							}
						>
							{g.label}
						</SegmentedControlItem>
					))}
				</SegmentedControl>
				<Suspense fallback={<SummaryActionsPending />}>
					<SummaryActions input={input} from={from} to={to} />
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

function SummaryActions({
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
	const total = data.rows.reduce((sum, r) => sum + rowHours(r, input.tab), 0);
	return (
		<div className="flex items-center gap-3">
			<span className="flex items-baseline gap-2 whitespace-nowrap">
				<span className="eyebrow">Total hours</span>
				<span className="mono text-lg">{formatReportHours(total)}</span>
			</span>
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
									: [
											r.name,
											String(r.count),
											formatDecimalHours(r.secondsTotal),
										],
						),
					)
				}
			>
				Export CSV
			</Button>
		</div>
	);
}

function SummaryActionsPending() {
	return (
		<div className="flex items-center gap-3">
			<FigurePending label="Total hours" />
			<Button variant="outline" size="sm" disabled>
				Export CSV
			</Button>
		</div>
	);
}

type SortKey = "name" | "hours";

/** A column header that sorts the table, with the arrow on the active one. */
function SortHead({
	label,
	sortKey,
	sort,
	onSort,
	className,
}: {
	label: string;
	sortKey: SortKey;
	sort: { key: SortKey; dir: 1 | -1 };
	onSort: (key: SortKey) => void;
	className?: string;
}) {
	const active = sort.key === sortKey;
	return (
		<TableHead
			className={className}
			aria-sort={active ? (sort.dir > 0 ? "ascending" : "descending") : "none"}
		>
			<button
				type="button"
				onClick={() => onSort(sortKey)}
				className={cn(
					"inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/16",
					active && "text-foreground",
				)}
			>
				{label}
				{active &&
					(sort.dir > 0 ? (
						<CaretUpIcon weight="bold" className="size-3" />
					) : (
						<CaretDownIcon weight="bold" className="size-3" />
					))}
			</button>
		</TableHead>
	);
}

/** The hours, as a link into the Breakdown, with the bar that answers "who
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
	const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
		key: "hours",
		dir: -1,
	});
	const onSort = (key: SortKey) =>
		setSort((current) =>
			current.key === key
				? { key, dir: current.dir > 0 ? -1 : 1 }
				: { key, dir: key === "hours" ? -1 : 1 },
		);

	const rows = data.rows
		.filter((row) => matchesSearch(query, [row.name, row.clientName, row.code]))
		.sort((a, b) =>
			sort.key === "hours"
				? (rowHours(a, group) - rowHours(b, group)) * sort.dir
				: a.name.localeCompare(b.name, "hr") * sort.dir,
		);
	const max = Math.max(...data.rows.map((r) => rowHours(r, group)), 1);
	const total = data.rows.reduce((sum, r) => sum + rowHours(r, group), 0);

	// Where a click goes. A name opens the Breakdown pre-grouped the way that
	// entity is usually read; the hours open it by date.
	const breakdown = (
		filter: Pick<Search, "client" | "project" | "person">,
		by: BreakdownGroup,
	): Search => ({
		...search,
		view: "breakdown",
		client: undefined,
		project: undefined,
		person: undefined,
		task: undefined,
		...filter,
		by,
	});

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
						className="mt-6 w-full sm:w-56"
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
									<TableHead className="text-right">Projects</TableHead>
								)}
								{group === "projects" && (
									<>
										<TableHead>Client</TableHead>
										<TableHead className="text-right">People</TableHead>
									</>
								)}
								{group === "teammates" && (
									<>
										<TableHead className="text-right">Work</TableHead>
										<TableHead className="text-right">Time-off</TableHead>
									</>
								)}
								<SortHead
									label="Hours"
									sortKey="hours"
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
											{group === "clients" && (
												<Link
													to="/$orgSlug/reports"
													params={{ orgSlug }}
													search={breakdown({ client: row.id }, "project")}
													className="underlined"
												>
													{row.name}
												</Link>
											)}
											{group === "projects" && (
												// The project page (Team · Tasks · Entries · Manage)
												// takes this link over once it exists; until then the
												// name opens the entries by teammate, which is the
												// question a project's row usually gets asked.
												<Link
													to="/$orgSlug/reports"
													params={{ orgSlug }}
													search={breakdown({ project: row.id }, "teammate")}
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
											)}
											{group === "teammates" && (
												<Link
													to="/$orgSlug/reports"
													params={{ orgSlug }}
													search={breakdown({ person: row.id }, "project")}
													className="underlined"
												>
													<PersonCell userId={row.id} name={row.name} />
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
												to={breakdown(
													group === "clients"
														? { client: row.id }
														: group === "projects"
															? { project: row.id }
															: { person: row.id },
													"date",
												)}
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
							? "Click a project to see who worked on it; click the hours to see its entries by date."
							: "Click a name to break it down by project; click the hours to see the entries by date."}{" "}
						Time-off is counted in Team only — it belongs to nobody's client.
					</p>
				</>
			)}
		</>
	);
}

// ── Level 2: the Breakdown ──────────────────────────────────────────────────

/**
 * Every entry behind a number, under the filters in force, grouped one of five
 * ways. The header — breadcrumb, filters, group-by — sits outside the boundary
 * its own controls trip, so narrowing to one task never takes the select you
 * narrowed with off the screen.
 */
function Breakdown({
	orgSlug,
	search,
	from,
	to,
	activeOnly,
}: {
	orgSlug: string;
	search: Search;
	from: string;
	to: string;
	activeOnly: boolean;
}) {
	const by: BreakdownGroup = search.by ?? "date";
	const input: TimeReportDetailInput = {
		from,
		to,
		clientId: search.client,
		projectId: search.project,
		taskId: search.task,
		userId: search.person,
		activeOnly,
	};
	const navigate = useNavigate({ from: "/$orgSlug/reports" });
	const go = (patch: Partial<Search>) =>
		navigate({
			to: "/$orgSlug/reports",
			params: { orgSlug },
			search: { ...search, ...patch },
		});

	return (
		<>
			<div className="mt-6 flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-3">
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
						Time report
					</Link>
					<h2 className="h2">Breakdown</h2>
				</div>
				<Suspense fallback={<BreakdownActionsPending />}>
					<BreakdownActions input={input} from={from} to={to} />
				</Suspense>
			</div>

			<div className="mt-4 flex flex-wrap items-center gap-2">
				<FilterSelect
					placeholder="All clients"
					value={search.client}
					onChange={(client) => go({ client })}
					optionsQuery="clients"
				/>
				<FilterSelect
					placeholder="All projects"
					value={search.project}
					onChange={(project) => go({ project })}
					optionsQuery="projects"
				/>
				<FilterSelect
					placeholder="All tasks"
					value={search.task}
					onChange={(task) => go({ task })}
					optionsQuery="tasks"
				/>
				<FilterSelect
					placeholder="Everyone"
					value={search.person}
					onChange={(person) => go({ person })}
					optionsQuery="people"
				/>
				<label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
					Group by
					<Select
						items={BREAKDOWN_GROUPS.map((g) => ({
							value: g.id,
							label: g.label,
						}))}
						value={by}
						onValueChange={(next: string | null) => {
							const picked = BREAKDOWN_GROUPS.find((g) => g.id === next);
							if (picked) go({ by: picked.id });
						}}
					>
						<SelectTrigger className="h-8 w-36 text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{BREAKDOWN_GROUPS.map((g) => (
								<SelectItem key={g.id} value={g.id}>
									{g.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</label>
			</div>

			<Suspense fallback={<TabPending className="mt-6" />}>
				<BreakdownTable input={input} by={by} />
			</Suspense>
		</>
	);
}

/** The total, the counts and the export — all a function of the rows the
 *  filters selected, so they load with the table, not with the header. */
function BreakdownActions({
	input,
	from,
	to,
}: {
	input: TimeReportDetailInput;
	from: string;
	to: string;
}) {
	const orgSlug = useOrgSlug();
	const { data: detail } = useSuspenseQuery(
		timeReportDetailQuery(orgSlug, input),
	);
	const rows = detail.rows;
	const people = new Set(rows.map((r) => r.userId)).size;

	return (
		<div className="flex items-center gap-3">
			<span className="flex items-baseline gap-2 whitespace-nowrap">
				<span className="eyebrow">Total hours</span>
				{/* The service's figure, summed across every matching row — not
				    `rows`, which the service caps. */}
				<span className="mono text-lg">
					{formatReportHours(detail.totalSeconds)}
				</span>
				<span className="text-xs text-muted-foreground">
					{detail.totalRows.toLocaleString("hr-HR")}{" "}
					{detail.totalRows === 1 ? "entry" : "entries"} · {people}{" "}
					{people === 1 ? "person" : "people"}
				</span>
			</span>
			<Button
				variant="outline"
				size="sm"
				disabled={rows.length === 0}
				onClick={() =>
					downloadCsv(
						`time-breakdown_${from}_${to}.csv`,
						[
							"Date",
							"Client",
							"Project",
							"Code",
							"Task",
							"Person",
							"Hours",
							"Overtime",
							"Description",
						],
						rows.map((r) => [
							r.date,
							r.clientName,
							r.projectName,
							r.projectCode ?? "",
							r.taskName,
							r.userName,
							formatDecimalHours(r.durationSeconds),
							r.overtime ? "yes" : "",
							r.description,
						]),
					)
				}
			>
				Export CSV
			</Button>
		</div>
	);
}

function BreakdownActionsPending() {
	return (
		<div className="flex items-center gap-3">
			<FigurePending label="Total hours" />
			<Button variant="outline" size="sm" disabled>
				Export CSV
			</Button>
		</div>
	);
}

const BREAKDOWN_COLUMNS: {
	id: BreakdownGroup;
	label: string;
	muted?: boolean;
}[] = [
	{ id: "client", label: "Client", muted: true },
	{ id: "project", label: "Project" },
	{ id: "task", label: "Task" },
	{ id: "teammate", label: "Person" },
	{ id: "date", label: "Date", muted: true },
];

function BreakdownTable({
	input,
	by,
}: {
	input: TimeReportDetailInput;
	by: BreakdownGroup;
}) {
	const orgSlug = useOrgSlug();
	const { data: detail } = useSuspenseQuery(
		timeReportDetailQuery(orgSlug, input),
	);
	const rows = detail.rows;
	const [query, setQuery] = useState("");
	// The search box only ever narrows what's already loaded — when the server
	// truncated the entries, a search finds nothing past that cutoff, same as
	// the CSV export.
	const filteredRows = rows.filter((row) =>
		matchesSearch(query, [
			row.description,
			row.userName,
			row.clientName,
			row.projectName,
			row.projectCode,
			row.taskName,
		]),
	);

	const keyOf = (row: (typeof rows)[number]) =>
		by === "client"
			? row.clientName
			: by === "project"
				? row.projectName
				: by === "task"
					? row.taskName
					: by === "teammate"
						? row.userName
						: row.date;
	const groups = new Map<string, { rows: typeof rows; seconds: number }>();
	for (const row of filteredRows) {
		const key = keyOf(row);
		const group = groups.get(key) ?? { rows: [], seconds: 0 };
		group.rows.push(row);
		group.seconds += row.durationSeconds;
		groups.set(key, group);
	}
	// Dates read in order; everything else biggest first — the group's sum is
	// the point of the header row, so the header rows sort by it.
	const ordered = [...groups.entries()].sort(([ka, a], [kb, b]) =>
		by === "date" ? ka.localeCompare(kb) : b.seconds - a.seconds,
	);
	const columns = BREAKDOWN_COLUMNS.filter((c) => c.id !== by);
	const groupLabel = BREAKDOWN_GROUPS.find((g) => g.id === by)?.label ?? "";

	const cellOf = (row: (typeof rows)[number], column: BreakdownGroup) =>
		column === "client"
			? row.clientName
			: column === "project"
				? `${row.projectCode ? `[${row.projectCode}] ` : ""}${row.projectName}`
				: column === "task"
					? row.taskName
					: column === "teammate"
						? row.userName
						: formatDateHeading(row.date);

	return (
		<>
			{rows.length === 0 ? (
				<p className="mt-5 border-t pt-5 text-base text-muted-foreground">
					No entries match these filters.
				</p>
			) : (
				<>
					{detail.truncated && (
						// Say it rather than just showing fewer rows: the Total above is the
						// whole figure, so a quietly short table would read as a table that
						// disagrees with its own total.
						<p className="mt-5 border-t pt-5 text-base text-warn">
							Showing the first {rows.length.toLocaleString("hr-HR")} of{" "}
							{detail.totalRows.toLocaleString("hr-HR")} entries — the CSV
							export covers the same {rows.length.toLocaleString("hr-HR")}. The
							Total above is the full figure. Narrow the filters or the period
							to see the rest.
						</p>
					)}
					<SearchInput
						value={query}
						onValueChange={setQuery}
						className="mt-6 w-full sm:w-56"
					/>
					<Table containerClassName="mt-3">
						<TableHeader>
							<TableRow>
								{columns.map((c) => (
									<TableHead key={c.id}>{c.label}</TableHead>
								))}
								<TableHead className="text-right">Hours</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{ordered.length === 0 ? (
								<NoMatchesRow colSpan={columns.length + 1} />
							) : (
								ordered.map(([key, group]) => (
									<Fragment key={key}>
										<TableRow className="bg-secondary/60 hover:bg-secondary/60">
											<TableCell
												colSpan={columns.length}
												className="font-medium"
											>
												<span className="eyebrow mr-2">{groupLabel}</span>
												{by === "date" ? formatDateHeading(key) : key}
											</TableCell>
											<TableCell className="mono text-right font-medium">
												{formatReportHours(group.seconds)}
											</TableCell>
										</TableRow>
										{group.rows.map((row) => (
											<TableRow key={row.id}>
												{columns.map((c) => (
													<TableCell
														key={c.id}
														className={cn(
															c.muted && "text-muted-foreground",
															c.id === "task" && "max-w-[36ch]",
														)}
													>
														{cellOf(row, c.id)}
														{c.id === "task" && (
															// The description sits under the task: it is what the
															// task meant that day, and a row without one says so
															// rather than reading as a task with nothing to add.
															<span
																className={cn(
																	"block truncate text-xs",
																	row.description
																		? "text-muted-foreground"
																		: "text-faint italic",
																)}
															>
																{row.description || "No description"}
															</span>
														)}
													</TableCell>
												))}
												<TableCell className="mono text-right">
													{formatReportHours(row.durationSeconds)}
													{row.overtime && (
														<span className="ml-2 rounded-full bg-warn/12 px-1.5 py-0.5 text-2xs font-medium text-warn">
															OT
														</span>
													)}
												</TableCell>
											</TableRow>
										))}
									</Fragment>
								))
							)}
						</TableBody>
					</Table>
				</>
			)}
		</>
	);
}

/** One of the Breakdown's four filters. Each reads the list it filters on;
 *  "All …" clears it. */
function FilterSelect({
	placeholder,
	value,
	onChange,
	optionsQuery,
}: {
	placeholder: string;
	value: string | undefined;
	onChange: (value: string | undefined) => void;
	optionsQuery: "clients" | "projects" | "tasks" | "people";
}) {
	const orgSlug = useOrgSlug();
	const clients = useSuspenseQuery(clientsQuery(orgSlug));
	const projects = useSuspenseQuery(projectsQuery(orgSlug));
	const tasks = useSuspenseQuery(selectableTasksQuery(orgSlug));
	const people = useSuspenseQuery(directoryQuery(orgSlug));

	const source =
		optionsQuery === "clients"
			? clients.data.map((c) => ({ value: c.id, label: c.name }))
			: optionsQuery === "projects"
				? projects.data.map((p) => ({
						value: p.id,
						label: p.code ? `[${p.code}] ${p.name}` : p.name,
					}))
				: optionsQuery === "tasks"
					? tasks.data.map((t) => ({ value: t.id, label: t.name }))
					: people.data.map((m) => ({ value: m.userId, label: m.name }));

	const ALL = "__all__";
	const items = [{ value: ALL, label: placeholder }, ...source];

	return (
		<Select
			items={items}
			value={value ?? ALL}
			onValueChange={(next: string | null) =>
				onChange(next == null || next === ALL ? undefined : next)
			}
		>
			<SelectTrigger
				className={cn(
					"h-8 w-44 text-xs",
					value && "border-ring text-foreground",
				)}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{items.map((item) => (
					<SelectItem key={item.value} value={item.value}>
						{item.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
