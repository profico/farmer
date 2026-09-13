import {
	formatDecimalHours,
	formatReportHours,
} from "@farmer/core/lib/report-format";
import { resolveReportPeriod } from "@farmer/core/lib/report-period";
import type {
	TimeReportDetailInput,
	TimeReportSummaryInput,
} from "@farmer/core/schema";
import type { TimeReportDetailRow } from "@farmer/core/services";
import {
	ArrowLeftIcon,
	CaretDownIcon,
	CaretRightIcon,
	CaretUpIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Fragment, Suspense, useMemo, useState } from "react";

import { PersonCell } from "#/components/person-avatar.tsx";
import { returnLinkClass } from "#/components/time/time-toolbar.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Combobox,
	ComboboxCollection,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxGroup,
	ComboboxGroupLabel,
	ComboboxItem,
	ComboboxList,
	ComboboxTrigger,
	ComboboxValue,
} from "#/components/ui/combobox.tsx";
import { NoMatchesRow, SearchInput } from "#/components/ui/search-input.tsx";
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

// The Time report (PRD 6.1), laid out the way the COO signed it off against
// Harvest, in two control rows and no more:
//
//   row 1  the period — one stepper with the preset inside it — and, at the
//          right, "Active projects only" and the CSV export;
//   row 2  where you are — on the report, the Clients · Projects · Team tabs
//          with the total at the right; in a drill-down, "← Projects", the
//          thing you opened as the title, any extra narrowing as chips, and
//          "+ Filter" — followed by the table.
//
// The drill-down reads the way Harvest's does: click a project and its people
// appear as summary rows, closed; open one and their entries sit under it.
// Click the hours instead and the same entries come grouped by date. The
// thing you opened is the title — going back is how you drop it — so the
// crumb never repeats a chip. Hours are written the way the accounting book
// writes them (1.821,50).

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
	{ id: "clients", label: "Clients", noun: "clients" },
	{ id: "projects", label: "Projects", noun: "projects" },
	{ id: "teammates", label: "Team", noun: "people" },
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

/** The four things a drill-down can be narrowed by, named by their search
 *  param. One of them is the drill-down's subject — the row that was clicked
 *  on the summary tab — and the rest are chips. */
type FilterKind = "client" | "project" | "person" | "task";
const FILTER_KINDS = [
	{ kind: "client", label: "Client", group: "Clients" },
	{ kind: "project", label: "Project", group: "Projects" },
	{ kind: "person", label: "Person", group: "People" },
	{ kind: "task", label: "Task", group: "Tasks" },
] as const satisfies readonly {
	kind: FilterKind;
	label: string;
	group: string;
}[];

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
	const { from, to } = resolveReportPeriod(search, today);
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
				orgSlug={orgSlug}
				search={search}
				today={today}
				thisMonth={thisMonth}
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
						<DetailExport input={detailInput} from={from} to={to} />
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
				{/* Quiet tabs — an underscore, not a second pill strip under the
				    report tabs. The same 2px accent underscore the week strip uses
				    for the active day. */}
				<nav aria-label="Group by" className="flex gap-5">
					{GROUPS.map((g) => {
						const active = input.tab === g.id;
						return (
							<Link
								key={g.id}
								to="/$orgSlug/reports"
								params={{ orgSlug }}
								search={{ ...search, group: g.id }}
								aria-current={active ? "page" : undefined}
								className={cn(
									"border-b-2 py-1.5 text-sm transition-colors duration-(--dur-fast)",
									active
										? "border-primary font-medium text-foreground"
										: "border-transparent text-muted-foreground hover:text-foreground",
								)}
							>
								{g.label}
							</Link>
						);
					})}
				</nav>
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

	// Where a click goes. A row's name opens it pre-grouped the way that entity
	// is usually read; the hours open it by date. Only this tab's own filter
	// travels: the row IS the subject of the drill-down.
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
							? "A project opens its people; the hours open its entries by date."
							: "A name opens it by project; the hours open the entries by date."}{" "}
						Time-off is counted in Team only — it belongs to nobody's client.
					</p>
				</>
			)}
		</>
	);
}

// ── Level 2: the drill-down ────────────────────────────────────────────────

/** Which groups are open: closed except a few (the default), or open except a
 *  few (after "Expand all"). Named by exception so "all" needs no list of
 *  keys, which only the table knows. */
type Expand = { mode: "closed" | "open"; except: ReadonlySet<string> };
const ALL_CLOSED: Expand = { mode: "closed", except: new Set() };
const ALL_OPEN: Expand = { mode: "open", except: new Set() };
const isOpen = (expand: Expand, key: string) =>
	(expand.mode === "open") !== expand.except.has(key);
const toggled = (expand: Expand, key: string): Expand => {
	const except = new Set(expand.except);
	if (except.has(key)) except.delete(key);
	else except.add(key);
	return { mode: expand.mode, except };
};

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
	const [query, setQuery] = useState("");
	const [expand, setExpand] = useState<Expand>(ALL_CLOSED);

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
					<DetailFigure input={input} />
				</Suspense>
			</div>

			<div className="mt-4 flex flex-wrap items-center gap-3">
				<SearchInput
					value={query}
					onValueChange={setQuery}
					placeholder="Search entries…"
					className="w-full sm:w-56"
				/>
				<label className="flex items-center gap-2 text-sm text-muted-foreground">
					Group by
					<Select
						items={BREAKDOWN_GROUPS.map((g) => ({
							value: g.id,
							label: g.label,
						}))}
						value={by}
						onValueChange={(next: string | null) => {
							const picked = BREAKDOWN_GROUPS.find((g) => g.id === next);
							if (!picked) return;
							// New groups, so the old open set means nothing.
							setExpand(ALL_CLOSED);
							go({ by: picked.id });
						}}
					>
						<SelectTrigger className="h-8 w-32 text-sm">
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
				<button
					type="button"
					className={`${returnLinkClass} ml-auto`}
					onClick={() =>
						setExpand(expand.mode === "open" ? ALL_CLOSED : ALL_OPEN)
					}
				>
					{expand.mode === "open" ? "Collapse all" : "Expand all"}
				</button>
			</div>

			<Suspense fallback={<TabPending className="mt-6" />}>
				<BreakdownTable
					input={input}
					by={by}
					query={query}
					expand={expand}
					onToggle={(key) => setExpand(toggled(expand, key))}
				/>
			</Suspense>
		</>
	);
}

type EntityName = { label: string; code: string | null; hint: string | null };

/**
 * The names behind the ids in the URL.
 *
 * The org's lists first — cached, and what the filter picker reads anyway —
 * then the entries themselves: a Team Lead's project list holds only their
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

	return { clients, projects, people, tasks, nameOf };
}

type FilterItem = {
	/** Unique across the four kinds. */
	value: string;
	kind: FilterKind;
	id: string;
	label: string;
	code: string | null;
	hint: string | null;
};
type FilterGroup = { value: FilterKind; label: string; items: FilterItem[] };

/** The subject as the title, the extra filters as chips, and the picker that
 *  adds one. The subject is not a chip: going back is how you drop it. */
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
	const { clients, projects, people, tasks, nameOf } = useEntityNames(input);
	const subjectId = search[subject];
	const title = subjectId ? nameOf(subject, subjectId) : null;
	const chips = FILTER_KINDS.filter(
		(k) => k.kind !== subject && search[k.kind],
	);

	// What "+ Filter" may still add: every kind not yet in force. A project
	// fixes its client, so a client is not offered beside one; under a client,
	// only that client's projects are.
	const groups = useMemo<FilterGroup[]>(() => {
		const out: FilterGroup[] = [];
		if (!search.client && !search.project) {
			out.push({
				value: "client",
				label: "Clients",
				items: clients.map((c) => ({
					value: `client:${c.id}`,
					kind: "client",
					id: c.id,
					label: c.name,
					code: null,
					hint: null,
				})),
			});
		}
		if (!search.project) {
			out.push({
				value: "project",
				label: "Projects",
				items: projects
					.filter((p) => !search.client || p.client?.id === search.client)
					.map((p): FilterItem => ({
						value: `project:${p.id}`,
						kind: "project",
						id: p.id,
						label: p.name,
						code: p.code,
						hint:
							[
								search.client ? null : (p.client?.name ?? null),
								p.status === "active" ? null : "archived",
							]
								.filter((h) => h !== null)
								.join(" · ") || null,
					}))
					.sort((a, b) => a.label.localeCompare(b.label)),
			});
		}
		if (!search.person) {
			out.push({
				value: "person",
				label: "People",
				items: people.map((m) => ({
					value: `person:${m.userId}`,
					kind: "person",
					id: m.userId,
					label: m.name,
					code: null,
					hint: null,
				})),
			});
		}
		if (!search.task) {
			out.push({
				value: "task",
				label: "Tasks",
				items: tasks.map((t) => ({
					value: `task:${t.id}`,
					kind: "task",
					id: t.id,
					label: t.name,
					code: null,
					hint: null,
				})),
			});
		}
		return out;
	}, [
		clients,
		projects,
		people,
		tasks,
		search.client,
		search.project,
		search.person,
		search.task,
	]);

	const [pickerQuery, setPickerQuery] = useState("");
	const filtered = useMemo(() => {
		if (pickerQuery.trim() === "") return groups;
		return groups
			.map((g) => ({
				...g,
				items: g.items.filter((i) =>
					matchesSearch(pickerQuery, [i.label, i.code, i.hint]),
				),
			}))
			.filter((g) => g.items.length > 0);
	}, [groups, pickerQuery]);

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

			{groups.length > 0 && (
				<Combobox
					items={groups}
					filteredItems={filtered}
					// Never holds a value: picking one is a navigation, and the chip
					// it becomes is the thing that shows it.
					value={null}
					onValueChange={(item: FilterItem | null) => {
						if (item) go(filterPatch(item.kind, item.id));
					}}
					isItemEqualToValue={(a: FilterItem, b: FilterItem) =>
						a.value === b.value
					}
					itemToStringLabel={(item: FilterItem) => item.label}
					inputValue={pickerQuery}
					onInputValueChange={setPickerQuery}
					onOpenChange={(open) => {
						if (!open) setPickerQuery("");
					}}
					autoHighlight
				>
					<ComboboxTrigger
						aria-label="Add a filter"
						className="h-8 rounded-full border-dashed text-sm text-muted-foreground"
					>
						<ComboboxValue>{() => "+ Filter"}</ComboboxValue>
					</ComboboxTrigger>
					<ComboboxContent
						className="w-80"
						searchPlaceholder="Search clients, projects, people, tasks…"
					>
						<ComboboxEmpty>Nothing matches.</ComboboxEmpty>
						<ComboboxList>
							{(group: FilterGroup) => (
								<ComboboxGroup key={group.value} items={group.items}>
									<ComboboxGroupLabel>{group.label}</ComboboxGroupLabel>
									<ComboboxCollection>
										{(item: FilterItem) => (
											<ComboboxItem key={item.value} value={item}>
												<span className="truncate">{item.label}</span>
												{item.code && (
													<span className="mono shrink-0 text-xs text-muted-foreground">
														{item.code}
													</span>
												)}
												{item.hint && (
													<span className="shrink-0 text-xs text-faint">
														{item.hint}
													</span>
												)}
											</ComboboxItem>
										)}
									</ComboboxCollection>
								</ComboboxGroup>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			)}
		</>
	);
}

/** The total and the counts — a function of the rows the filters selected, so
 *  they load with the table, not with the header. */
function DetailFigure({ input }: { input: TimeReportDetailInput }) {
	const orgSlug = useOrgSlug();
	const { data: detail } = useSuspenseQuery(
		timeReportDetailQuery(orgSlug, input),
	);
	const people = new Set(detail.rows.map((r) => r.userId)).size;
	return (
		<span className="ml-auto flex items-baseline gap-2 whitespace-nowrap">
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
	);
}

function DetailExport({
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
	return (
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

type DetailRow = TimeReportDetailRow;

type DetailGroup = {
	key: string;
	label: string;
	/** The group's own identity for rendering its header: a person's face, a
	 *  project's code. From the first row in, which every row shares. */
	userId: string;
	projectCode: string | null;
	rows: DetailRow[];
	seconds: number;
	people: Set<string>;
};

function BreakdownTable({
	input,
	by,
	query,
	expand,
	onToggle,
}: {
	input: TimeReportDetailInput;
	by: BreakdownGroup;
	query: string;
	expand: Expand;
	onToggle: (key: string) => void;
}) {
	const orgSlug = useOrgSlug();
	const { data: detail } = useSuspenseQuery(
		timeReportDetailQuery(orgSlug, input),
	);
	const rows = detail.rows;
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

	// Grouped by id, not by name: two people can share a name.
	const keyOf = (row: DetailRow) =>
		by === "client"
			? row.clientId
			: by === "project"
				? row.projectId
				: by === "task"
					? row.taskId
					: by === "teammate"
						? row.userId
						: row.date;
	const labelOf = (row: DetailRow) =>
		by === "client"
			? row.clientName
			: by === "project"
				? row.projectName
				: by === "task"
					? row.taskName
					: by === "teammate"
						? row.userName
						: formatDateHeading(row.date);
	const groups = new Map<string, DetailGroup>();
	for (const row of filteredRows) {
		const key = keyOf(row);
		const group = groups.get(key) ?? {
			key,
			label: labelOf(row),
			userId: row.userId,
			projectCode: row.projectCode,
			rows: [],
			seconds: 0,
			people: new Set<string>(),
		};
		group.rows.push(row);
		group.seconds += row.durationSeconds;
		group.people.add(row.userId);
		groups.set(key, group);
	}
	// Dates read in order; everything else biggest first — the group's sum is
	// the point of the header row, so the header rows sort by it.
	const ordered = [...groups.values()].sort((a, b) =>
		by === "date" ? a.key.localeCompare(b.key) : b.seconds - a.seconds,
	);

	// A column every row would repeat says nothing: the project you opened,
	// its client, the person a chip narrowed to. The task column stays — it
	// carries the note.
	const fixed = new Set<BreakdownGroup>([
		...(input.clientId || input.projectId ? ["client" as const] : []),
		...(input.projectId ? ["project" as const] : []),
		...(input.userId ? ["teammate" as const] : []),
	]);
	const columns = BREAKDOWN_COLUMNS.filter(
		(c) => c.id !== by && !fixed.has(c.id),
	);

	const cellOf = (row: DetailRow, column: BreakdownGroup) =>
		column === "client"
			? row.clientName
			: column === "project"
				? `${row.projectCode ? `[${row.projectCode}] ` : ""}${row.projectName}`
				: column === "task"
					? row.taskName
					: column === "teammate"
						? row.userName
						: formatDateHeading(row.date);

	if (rows.length === 0) {
		return (
			<p className="mt-5 border-t pt-5 text-base text-muted-foreground">
				No entries match these filters.
			</p>
		);
	}

	return (
		<>
			{detail.truncated && (
				// Say it rather than just showing fewer rows: the Total above is the
				// whole figure, so a quietly short table would read as a table that
				// disagrees with its own total.
				<p className="mt-5 border-t pt-5 text-base text-warn">
					Showing the first {rows.length.toLocaleString("hr-HR")} of{" "}
					{detail.totalRows.toLocaleString("hr-HR")} entries — the CSV export
					covers the same {rows.length.toLocaleString("hr-HR")}. The Total above
					is the full figure. Narrow the filters or the period to see the rest.
				</p>
			)}
			<Table containerClassName="mt-4">
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
						ordered.map((group) => {
							const open = isOpen(expand, group.key);
							return (
								<Fragment key={group.key}>
									{/* The summary row: a disclosure, the same one the
									    archived section under every list uses. */}
									<TableRow className="bg-secondary/60 hover:bg-secondary">
										<TableCell colSpan={columns.length} className="p-0">
											<button
												type="button"
												aria-expanded={open}
												onClick={() => onToggle(group.key)}
												className="flex w-full items-center gap-2 px-2 py-2.5 text-left font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/16 focus-visible:ring-inset"
											>
												<CaretRightIcon
													weight="bold"
													className={cn(
														"size-3 shrink-0 text-muted-foreground transition-transform duration-(--dur-fast)",
														open && "rotate-90",
													)}
												/>
												{by === "teammate" ? (
													<PersonCell
														userId={group.userId}
														name={group.label}
													/>
												) : (
													<>
														{by === "project" && group.projectCode && (
															<span className="mono text-xs text-muted-foreground">
																[{group.projectCode}]
															</span>
														)}
														{group.label}
													</>
												)}
												<span className="text-sm font-normal text-muted-foreground">
													{group.rows.length}{" "}
													{group.rows.length === 1 ? "entry" : "entries"}
													{by !== "teammate" &&
														` · ${group.people.size} ${group.people.size === 1 ? "person" : "people"}`}
												</span>
											</button>
										</TableCell>
										<TableCell className="mono text-right font-medium">
											{formatReportHours(group.seconds)}
										</TableCell>
									</TableRow>
									{open &&
										group.rows.map((row) => (
											<TableRow key={row.id}>
												{columns.map((c, i) => (
													<TableCell
														key={c.id}
														className={cn(
															i === 0 && "pl-7",
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
							);
						})
					)}
				</TableBody>
			</Table>
		</>
	);
}
