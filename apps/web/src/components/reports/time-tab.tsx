import {
	formatDecimalHours,
	formatHoursLabel,
} from "@farmer/core/lib/report-format";
import { resolveReportPeriod } from "@farmer/core/lib/report-period";
import type { TimeReportDetailInput } from "@farmer/core/schema";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment, Suspense, useState } from "react";
import { returnLinkClass } from "#/components/time/time-toolbar.tsx";
import { Button } from "#/components/ui/button.tsx";
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
import { formatClock } from "#/lib/format-hours.ts";
import { cn } from "#/lib/utils.ts";
import { clientsQuery } from "#/queries/clients.ts";
import { projectsQuery } from "#/queries/projects.ts";
import {
	timeReportDetailQuery,
	timeReportSummaryQuery,
} from "#/queries/reports.ts";
import { selectableTasksQuery } from "#/queries/tasks.ts";
import type { Search } from "./search.ts";
import { formatDateHeading, PeriodPicker, TabPending } from "./shared.tsx";

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

// ── Period navigation ───────────────────────────────────────────────────────
// Same geometry as the timesheet's stepper (TimeToolbar), for the same reason
// it's shared across Day/Week/Month there: the eye should not have to re-find
// the arrows when the screen changes.

const GROUPS = [
	{ id: "clients", label: "Clients" },
	{ id: "projects", label: "Projects" },
	{ id: "teammates", label: "Teammates" },
] as const;

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
	const group = search.group ?? "projects";
	const { from, to } = resolveReportPeriod(search, today);

	if (
		search.detailId &&
		search.detailKind &&
		search.detailKind !== "overtime"
	) {
		return (
			<TimeDetail
				orgSlug={orgSlug}
				search={search}
				from={from}
				to={to}
				kind={search.detailKind}
				id={search.detailId}
			/>
		);
	}

	return (
		<>
			<PeriodPicker
				orgSlug={orgSlug}
				search={search}
				today={today}
				thisMonth={thisMonth}
			/>
			<TimeSummary
				orgSlug={orgSlug}
				search={search}
				group={group}
				from={from}
				to={to}
			/>
		</>
	);
}

/**
 * The Clients/Projects/Teammates grouping, and the figures behind it.
 *
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
}: {
	orgSlug: string;
	search: Search;
	group: "clients" | "projects" | "teammates";
	from: string;
	to: string;
}) {
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
									search={{ ...search, group: g.id, detailId: undefined }}
								/>
							}
						>
							{g.label}
						</SegmentedControlItem>
					))}
				</SegmentedControl>
				<Suspense fallback={<FigurePending label="Total" />}>
					<TimeSummaryTotal group={group} from={from} to={to} />
				</Suspense>
			</div>

			<Suspense fallback={<TabPending className="mt-6" />}>
				<TimeSummaryRows
					orgSlug={orgSlug}
					search={search}
					group={group}
					from={from}
					to={to}
				/>
			</Suspense>
		</>
	);
}

function TimeSummaryTotal({
	group,
	from,
	to,
}: {
	group: "clients" | "projects" | "teammates";
	from: string;
	to: string;
}) {
	const orgSlug = useOrgSlug();
	const { data } = useSuspenseQuery(
		timeReportSummaryQuery(orgSlug, { from, to, tab: group }),
	);
	return (
		<span className="flex items-baseline gap-2 whitespace-nowrap">
			<span className="eyebrow">Total</span>
			<span className="mono text-lg">
				{formatHoursLabel(data.totalSeconds)}
			</span>
		</span>
	);
}

function TimeSummaryRows({
	orgSlug,
	search,
	group,
	from,
	to,
}: {
	orgSlug: string;
	search: Search;
	group: "clients" | "projects" | "teammates";
	from: string;
	to: string;
}) {
	const { data } = useSuspenseQuery(
		timeReportSummaryQuery(orgSlug, { from, to, tab: group }),
	);

	return (
		<>
			{/* Time with no project — synced meetings and fill blocks nobody has
			    filed yet. It cannot appear in the rows below (there is no client or
			    project to group it under) and it is deliberately not added to the
			    total, or the rows would stop summing to the figure above. Saying so
			    is the point: the old behaviour was to drop it silently, which just
			    made the total quietly wrong. */}
			{data.unfiledSeconds > 0 && (
				<p className="mt-4 text-sm text-muted-foreground">
					<span className="mono">{formatHoursLabel(data.unfiledSeconds)}</span>{" "}
					in this period isn't filed against any project and is not included
					above.
				</p>
			)}

			{data.rows.length === 0 ? (
				<p className="mt-5 border-t pt-5 text-base text-muted-foreground">
					Nothing logged in this period.
				</p>
			) : (
				<Table containerClassName="mt-6">
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead className="text-right">Hours</TableHead>
							<TableHead className="w-1/3">Share</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.rows.map((row) => {
							const share =
								data.totalSeconds > 0
									? (row.secondsTotal / data.totalSeconds) * 100
									: 0;
							return (
								<TableRow key={row.id}>
									<TableCell className="font-medium">{row.name}</TableCell>
									<TableCell className="text-right">
										{/* Hours are the link, exactly as in Harvest: the number
										    is the thing you want to see behind. */}
										<Link
											to="/$orgSlug/reports"
											params={{ orgSlug }}
											search={{
												...search,
												detailKind: group,
												detailId: row.id,
											}}
											className="mono underlined"
										>
											{formatHoursLabel(row.secondsTotal)}
										</Link>
									</TableCell>
									<TableCell>
										{/* The bar is the report's one piece of chrome, and it
										    earns its place: it answers "who dominates this
										    period" without reading a single number. */}
										<span className="flex items-center gap-2">
											<span className="h-1.5 min-w-px flex-1 overflow-hidden rounded-full bg-secondary">
												<span
													className="block h-full rounded-full bg-primary"
													style={{ width: `${Math.max(share, 1)}%` }}
												/>
											</span>
											<span className="mono w-10 text-right text-xs text-muted-foreground">
												{Math.round(share)}%
											</span>
										</span>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			)}
		</>
	);
}

/**
 * Time report level 2 (PRD 6.1): every entry behind the clicked number.
 *
 * Grouped by date with daily subtotals, because that is how the raw data is
 * read back to somebody — "what happened on the 14th" — and the project
 * drill-down can regroup by person instead.
 *
 * The header and the three filters are outside the boundary the filters trip,
 * for the same reason the grouping control is upstairs: narrowing to one task
 * shouldn't take the select you narrowed with off the screen. The title comes
 * from the summary rather than the entries, so it survives a filter that
 * matches nothing.
 */
function TimeDetail({
	orgSlug,
	search,
	from,
	to,
	kind,
	id,
}: {
	orgSlug: string;
	search: Search;
	from: string;
	to: string;
	kind: "clients" | "projects" | "teammates";
	id: string;
}) {
	const groupBy = search.groupBy ?? "date";
	// The clicked entity is itself a filter, seeded into the matching select and
	// locked there; the other two refine inside it.
	const [clientFilter, setClientFilter] = useState<string | undefined>(
		kind === "clients" ? id : undefined,
	);
	const [projectFilter, setProjectFilter] = useState<string | undefined>(
		kind === "projects" ? id : undefined,
	);
	const [taskFilter, setTaskFilter] = useState<string | undefined>(undefined);

	const input = {
		from,
		to,
		groupBy,
		clientId: clientFilter,
		projectId: projectFilter,
		userId: kind === "teammates" ? id : undefined,
		taskId: taskFilter,
	};

	const { data: summary } = useSuspenseQuery(
		timeReportSummaryQuery(orgSlug, { from, to, tab: kind }),
	);
	const title = summary.rows.find((r) => r.id === id)?.name ?? "Detail";

	return (
		<>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<Link
						to="/$orgSlug/reports"
						params={{ orgSlug }}
						search={{ ...search, detailId: undefined, detailKind: undefined }}
						className={returnLinkClass}
					>
						← Back
					</Link>
					<h2 className="h2">{title}</h2>
				</div>
				<Suspense fallback={<TimeDetailActionsPending />}>
					<TimeDetailActions input={input} from={from} to={to} />
				</Suspense>
			</div>

			<div className="mt-4 flex flex-wrap items-center gap-2">
				<FilterSelect
					placeholder="All clients"
					value={clientFilter}
					onChange={setClientFilter}
					disabled={kind === "clients"}
					optionsQuery="clients"
				/>
				<FilterSelect
					placeholder="All projects"
					value={projectFilter}
					onChange={setProjectFilter}
					disabled={kind === "projects"}
					optionsQuery="projects"
				/>
				<FilterSelect
					placeholder="All tasks"
					value={taskFilter}
					onChange={setTaskFilter}
					optionsQuery="tasks"
				/>
				{/* PRD 6.1: the project drill-down is the one that offers a group-by
				    toggle — a client's entries read by date, a person's trivially so. */}
				{kind === "projects" && (
					<SegmentedControl className="ml-auto">
						{(["date", "person"] as const).map((g) => (
							<SegmentedControlItem
								key={g}
								active={groupBy === g}
								render={
									<Link
										to="/$orgSlug/reports"
										params={{ orgSlug }}
										search={{ ...search, groupBy: g }}
									/>
								}
							>
								{g === "date" ? "By date" : "By person"}
							</SegmentedControlItem>
						))}
					</SegmentedControl>
				)}
			</div>

			<Suspense fallback={<TabPending className="mt-6" />}>
				<TimeDetailTable input={input} groupBy={groupBy} />
			</Suspense>
		</>
	);
}

/** The total and the export, both of which are a function of the rows the
 *  filters selected — so they load with the table, not with the header. */
function TimeDetailActions({
	input,
	from,
	to,
}: {
	input: TimeReportDetailInput;
	from: string;
	to: string;
}) {
	const orgSlug = useOrgSlug();
	const { data: rows } = useSuspenseQuery(
		timeReportDetailQuery(orgSlug, input),
	);
	const total = rows.reduce((sum, r) => sum + r.durationSeconds, 0);

	return (
		<div className="flex items-center gap-3">
			<span className="flex items-baseline gap-2 whitespace-nowrap">
				<span className="eyebrow">Total</span>
				<span className="mono text-lg">{formatHoursLabel(total)}</span>
			</span>
			<Button
				variant="outline"
				size="sm"
				disabled={rows.length === 0}
				onClick={() =>
					downloadCsv(
						`time-report_${from}_${to}.csv`,
						[
							"Date",
							"Client",
							"Project",
							"Task",
							"Person",
							"Description",
							"Hours",
							"Overtime",
						],
						rows.map((r) => [
							r.date,
							r.clientName,
							r.projectName,
							r.taskName,
							r.userName,
							r.description,
							formatDecimalHours(r.durationSeconds),
							r.overtime ? "yes" : "",
						]),
					)
				}
			>
				Export CSV
			</Button>
		</div>
	);
}

/** Holds the export button's place while the rows load, so the header doesn't
 *  reflow around a button that pops in a moment later. */
function TimeDetailActionsPending() {
	return (
		<div className="flex items-center gap-3">
			<FigurePending label="Total" />
			<Button variant="outline" size="sm" disabled>
				Export CSV
			</Button>
		</div>
	);
}

function TimeDetailTable({
	input,
	groupBy,
}: {
	input: TimeReportDetailInput;
	groupBy: "date" | "person";
}) {
	const orgSlug = useOrgSlug();
	const { data: rows } = useSuspenseQuery(
		timeReportDetailQuery(orgSlug, input),
	);

	// One pass, in the order the service already sorted them: it grouped by the
	// same key, so a running group beats re-sorting the rows here.
	const groups: { key: string; rows: typeof rows; seconds: number }[] = [];
	for (const row of rows) {
		const key = groupBy === "person" ? row.userName : row.date;
		const last = groups[groups.length - 1];
		if (last && last.key === key) {
			last.rows.push(row);
			last.seconds += row.durationSeconds;
		} else {
			groups.push({ key, rows: [row], seconds: row.durationSeconds });
		}
	}

	return (
		<>
			{rows.length === 0 ? (
				<p className="mt-5 border-t pt-5 text-base text-muted-foreground">
					No entries match these filters.
				</p>
			) : (
				<Table containerClassName="mt-6">
					<TableHeader>
						<TableRow>
							<TableHead>{groupBy === "person" ? "Date" : "Person"}</TableHead>
							<TableHead>Client</TableHead>
							<TableHead>Project</TableHead>
							<TableHead>Task</TableHead>
							<TableHead>Description</TableHead>
							<TableHead className="text-right">Hours</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{groups.map((group) => (
							<Fragment key={group.key}>
								<TableRow className="bg-secondary/60">
									<TableCell colSpan={5} className="font-medium">
										{groupBy === "person"
											? group.key
											: formatDateHeading(group.key)}
									</TableCell>
									<TableCell className="mono text-right font-medium">
										{formatClock(group.seconds)}
									</TableCell>
								</TableRow>
								{group.rows.map((row) => (
									<TableRow key={row.id}>
										<TableCell className="text-muted-foreground">
											{groupBy === "person"
												? formatDateHeading(row.date)
												: row.userName}
										</TableCell>
										<TableCell>{row.clientName}</TableCell>
										<TableCell>{row.projectName}</TableCell>
										<TableCell>{row.taskName}</TableCell>
										<TableCell className="max-w-[42ch] truncate text-muted-foreground">
											{row.description}
											{row.overtime && (
												<span className="ml-2 text-2xs text-warn">
													overtime
												</span>
											)}
										</TableCell>
										<TableCell className="mono text-right">
											{formatClock(row.durationSeconds)}
										</TableCell>
									</TableRow>
								))}
							</Fragment>
						))}
					</TableBody>
				</Table>
			)}
		</>
	);
}

/** The three level-2 filters. Each reads the list it filters on, and the one
 *  matching the drilled entity is locked — you got here by picking it. */
function FilterSelect({
	placeholder,
	value,
	onChange,
	disabled,
	optionsQuery,
}: {
	placeholder: string;
	value: string | undefined;
	onChange: (value: string | undefined) => void;
	disabled?: boolean;
	optionsQuery: "clients" | "projects" | "tasks";
}) {
	const orgSlug = useOrgSlug();
	const clients = useSuspenseQuery(clientsQuery(orgSlug));
	const projects = useSuspenseQuery(projectsQuery(orgSlug));
	const tasks = useSuspenseQuery(selectableTasksQuery(orgSlug));

	const source =
		optionsQuery === "clients"
			? clients.data.map((c) => ({ value: c.id, label: c.name }))
			: optionsQuery === "projects"
				? projects.data.map((p) => ({ value: p.id, label: p.name }))
				: tasks.data.map((t) => ({ value: t.id, label: t.name }));

	const ALL = "__all__";
	const items = [{ value: ALL, label: placeholder }, ...source];

	return (
		<Select
			items={items}
			value={value ?? ALL}
			disabled={disabled}
			onValueChange={(next: string | null) =>
				onChange(next == null || next === ALL ? undefined : next)
			}
		>
			<SelectTrigger className="h-8 w-44 text-xs">
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
