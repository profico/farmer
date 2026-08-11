import {
	formatDaysLabel,
	formatDecimalHours,
	formatHoursLabel,
	formatPctLabel,
} from "@farmer/core/lib/report-format";
import {
	isCurrentPeriod,
	PERIOD_PRESETS,
	parseMonthKey,
	resolveReportPeriod,
	shiftMonthKey,
} from "@farmer/core/lib/report-period";
import { addDaysToKey, dayKeyInTz } from "@farmer/core/lib/time";
import { rollUpUtilization } from "@farmer/core/lib/utilization";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, Suspense, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { TableLoadingSkeleton } from "#/components/states/loading-skeleton.tsx";
import {
	returnLinkClass,
	stepperClass,
	TimeToolbar,
} from "#/components/time/time-toolbar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { FadeSwap } from "#/components/ui/fade-swap.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { downloadCsv } from "#/lib/csv.ts";
import { formatMonthKey, formatWeekRange } from "#/lib/format-date.ts";
import { formatClock } from "#/lib/format-hours.ts";
import { cn } from "#/lib/utils.ts";
import { myAccessQuery } from "#/queries/access.ts";
import { clientsQuery } from "#/queries/clients.ts";
import { complianceDashboardQuery } from "#/queries/compliance.ts";
import { notOnInvoiceReportQuery } from "#/queries/not-on-invoice.ts";
import { projectsQuery } from "#/queries/projects.ts";
import {
	absenceReportQuery,
	budgetBurnReportQuery,
	overtimeDetailQuery,
	overtimeReportQuery,
	timeReportDetailQuery,
	timeReportSummaryQuery,
	utilizationReportQuery,
	utilizationTrendQuery,
	varianceReportQuery,
	varianceTrendQuery,
} from "#/queries/reports.ts";
import { selectableTasksQuery } from "#/queries/tasks.ts";
import { setNotOnInvoiceStatus } from "#/server/not-on-invoice.ts";

// Time, Budget burn and Overtime are project-scoped: Admin sees everything, a
// PM or Team Lead sees their own projects (the service narrows the rows). The
// rest are org-wide statements and Admin-only. A plain Member has no report at
// all — they see strictly their own entries, on the timesheet.
const TABS = [
	{ id: "time", label: "Time", adminOnly: false },
	{ id: "budget", label: "Budget burn", adminOnly: false },
	{ id: "overtime", label: "Overtime", adminOnly: false },
	{ id: "compliance", label: "Tracking", adminOnly: true },
	{ id: "absence", label: "Absence", adminOnly: true },
	{ id: "variance", label: "Variance", adminOnly: true },
	{ id: "utilization", label: "Utilization", adminOnly: true },
	{ id: "not-on-invoice", label: "Not on invoice", adminOnly: true },
] as const;

type TabId = (typeof TABS)[number]["id"];

const monthKey = z.string().regex(/^\d{4}-\d{2}$/);
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const searchSchema = z.object({
	tab: z
		.enum([
			"time",
			"budget",
			"overtime",
			"compliance",
			"absence",
			"variance",
			"utilization",
			"not-on-invoice",
		])
		.optional(),
	// The Time tab's own sub-grouping, mirroring Harvest's three tabs.
	group: z.enum(["clients", "projects", "teammates"]).optional(),
	// The period. `month` drives every month-based report and is also the Time
	// tab's default; `preset` lets Time widen to a week or an arbitrary range
	// (PRD 6.1), in which case `from`/`to` carry it.
	month: monthKey.optional(),
	preset: z.enum(["month", "week", "custom"]).optional(),
	from: dateKey.optional(),
	to: dateKey.optional(),
	// Level 2: which row was clicked, and how to group what's behind it.
	detailKind: z
		.enum(["clients", "projects", "teammates", "overtime"])
		.optional(),
	detailId: z.string().optional(),
	groupBy: z.enum(["date", "person"]).optional(),
});

type Search = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/$orgSlug/reports")({
	validateSearch: searchSchema,
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(myAccessQuery());
	},
	component: ReportsPage,
});

function ReportsPage() {
	const { organization } = Route.useRouteContext();
	const search = Route.useSearch();
	const { data: access } = useSuspenseQuery(myAccessQuery());

	const today = dayKeyInTz(new Date(), organization.timezone);
	const thisMonth = today.slice(0, 7);
	const month = search.month ?? thisMonth;
	const period = parseMonthKey(month);

	const visibleTabs = TABS.filter((t) => !t.adminOnly || access.isAdmin);
	// A tab this person can't see is treated as if it weren't asked for: the
	// admin-only ids stay valid search params (an admin's shared link must keep
	// working), so a Team Lead following one would otherwise render a body whose
	// query the service refuses — a blank panel and a 403 in the console.
	const requested = search.tab ?? "time";
	const tab: TabId = visibleTabs.some((t) => t.id === requested)
		? requested
		: "time";
	// Team Lead is the floor: below it there is nothing to show, and letting the
	// page render would just fire a query the service refuses.
	const canSeeAnything = access.isAdmin || access.isLeadSomewhere;

	if (!canSeeAnything) {
		return (
			<Page className="screen">
				<PageHeader eyebrow="Reports" title="Nothing here for you" />
				<p className="lede max-w-[62ch]">
					Reports cover a whole project's time, so they're for the people who
					run one. Your own hours are on the timesheet.
				</p>
			</Page>
		);
	}

	return (
		<Page className="screen">
			<PageHeader
				eyebrow={formatMonthKey(month)}
				title="Reports"
				className="mb-0"
			/>

			<div className="mt-6 overflow-x-auto">
				<SegmentedControl>
					{visibleTabs.map((t) => (
						<SegmentedControlItem
							key={t.id}
							active={tab === t.id}
							render={
								<Link
									to="/$orgSlug/reports"
									params={{ orgSlug: organization.slug }}
									// Deliberately drops every other search param: a period or
									// drill-down belongs to the tab it was set on, and carrying
									// a client filter into the Absence report would only ever
									// confuse.
									search={{ tab: t.id, month: search.month }}
									aria-current={tab === t.id ? "page" : undefined}
								/>
							}
						>
							{t.label}
						</SegmentedControlItem>
					))}
				</SegmentedControl>
			</div>

			{/* Every tab body reads its data with `useSuspenseQuery` and the route
			    loader only prefetches `myAccess`, so the first visit to a tab always
			    suspends. Without a boundary here that suspension escapes to the
			    router's own `defaultPendingComponent`, which swaps out the entire
			    route — header, tab strip and all — for `RoutePending`, held for at
			    least `defaultPendingMinMs`. It read exactly like a full page reload
			    on every first tab click. Keeping the boundary local means only the
			    panel below the tabs is replaced, and the tabs stay put and stay
			    clickable while it loads.

			    Keyed by tab so switching tabs re-suspends this boundary rather than
			    reusing the previous tab's resolved content.

			    `FadeSwap` sits *outside* the boundary on purpose: keyed on the same
			    tab, it crossfades one panel into the next, and the spinner-to-table
			    step inside stays uncrossfaded — that one is a sub-second wait on a
			    panel you are already looking at, and fading it would just make the
			    data land later than it actually did. */}
			<FadeSwap activeKey={tab} className="mt-6">
				<Suspense key={tab} fallback={<TabPending />}>
					{tab === "time" && (
						<TimeTab
							orgSlug={organization.slug}
							search={search}
							today={today}
							thisMonth={thisMonth}
						/>
					)}
					{tab === "budget" && <BudgetBurnTab />}
					{tab === "overtime" && (
						<MonthFramed
							orgSlug={organization.slug}
							search={search}
							month={month}
							thisMonth={thisMonth}
						>
							<OvertimeTab
								orgSlug={organization.slug}
								search={search}
								{...period}
							/>
						</MonthFramed>
					)}
					{tab === "compliance" && <ComplianceTab />}
					{tab === "absence" && (
						<MonthFramed
							orgSlug={organization.slug}
							search={search}
							month={month}
							thisMonth={thisMonth}
						>
							<AbsenceTab {...period} />
						</MonthFramed>
					)}
					{tab === "variance" && (
						<MonthFramed
							orgSlug={organization.slug}
							search={search}
							month={month}
							thisMonth={thisMonth}
						>
							<VarianceTab {...period} />
						</MonthFramed>
					)}
					{tab === "utilization" && (
						<MonthFramed
							orgSlug={organization.slug}
							search={search}
							month={month}
							thisMonth={thisMonth}
						>
							<UtilizationTab {...period} />
						</MonthFramed>
					)}
					{tab === "not-on-invoice" && (
						<MonthFramed
							orgSlug={organization.slug}
							search={search}
							month={month}
							thisMonth={thisMonth}
						>
							<NotOnInvoiceTab {...period} />
						</MonthFramed>
					)}
				</Suspense>
			</FadeSwap>
		</Page>
	);
}

/**
 * The in-panel loading state. Every tab on this screen resolves to a table, so
 * the placeholder is that table — which also keeps the promise the old spinner
 * only gestured at: the panel is roughly the height of what replaces it, so the
 * tab strip above doesn't jump when the data lands.
 */
function TabPending() {
	return (
		<div className="pt-1">
			<TableLoadingSkeleton />
		</div>
	);
}

// ── Period navigation ───────────────────────────────────────────────────────
// Same geometry as the timesheet's stepper (TimeToolbar), for the same reason
// it's shared across Day/Week/Month there: the eye should not have to re-find
// the arrows when the screen changes.

/** Wraps a month-based report in the month stepper. */
function MonthFramed({
	orgSlug,
	search,
	month,
	thisMonth,
	children,
}: {
	orgSlug: string;
	search: Search;
	month: string;
	thisMonth: string;
	children: React.ReactNode;
}) {
	const step = (delta: number) => (
		<Link
			to="/$orgSlug/reports"
			params={{ orgSlug }}
			search={{
				...search,
				month: shiftMonthKey(month, delta),
				detailId: undefined,
			}}
			className={stepperClass}
			aria-label={delta < 0 ? "Previous month" : "Next month"}
		>
			{delta < 0 ? "←" : "→"}
		</Link>
	);

	return (
		<>
			<TimeToolbar
				prev={step(-1)}
				label={formatMonthKey(month)}
				next={step(1)}
				returnLink={
					month !== thisMonth && (
						<Link
							to="/$orgSlug/reports"
							params={{ orgSlug }}
							search={{ ...search, month: undefined, detailId: undefined }}
							className={returnLinkClass}
						>
							Return to this month
						</Link>
					)
				}
			/>
			<div className="mt-6">{children}</div>
		</>
	);
}

function PeriodPicker({
	orgSlug,
	search,
	today,
	thisMonth,
	children,
}: {
	orgSlug: string;
	search: Search;
	today: string;
	thisMonth: string;
	children?: React.ReactNode;
}) {
	const { preset, from, to } = resolveReportPeriod(search, today);
	const month = search.month ?? thisMonth;

	const withSearch = (patch: Partial<Search>) => ({
		...search,
		...patch,
		// A drill-down belongs to the period it was opened in; moving the period
		// with a row still selected would show that row's entries for a range it
		// was never counted over.
		detailId: undefined,
		detailKind: undefined,
	});

	const step = (delta: number) => {
		if (preset === "week") {
			return withSearch({ from: addDaysToKey(from, 7 * delta), to: undefined });
		}
		return withSearch({ month: shiftMonthKey(month, delta) });
	};

	const label =
		preset === "month" ? formatMonthKey(month) : formatWeekRange(from, to);

	const atNow = isCurrentPeriod(search, today);

	return (
		<div className="flex flex-wrap items-center gap-3">
			{/* A custom range has no natural next, so it gets two date fields
			    instead of arrows rather than arrows that guess a stride. */}
			{preset === "custom" ? (
				<CustomRangeFields
					orgSlug={orgSlug}
					search={search}
					from={from}
					to={to}
				/>
			) : (
				<TimeToolbar
					prev={
						<Link
							to="/$orgSlug/reports"
							params={{ orgSlug }}
							search={step(-1)}
							className={stepperClass}
							aria-label="Previous period"
						>
							←
						</Link>
					}
					label={label}
					next={
						<Link
							to="/$orgSlug/reports"
							params={{ orgSlug }}
							search={step(1)}
							className={stepperClass}
							aria-label="Next period"
						>
							→
						</Link>
					}
					returnLink={
						!atNow && (
							<Link
								to="/$orgSlug/reports"
								params={{ orgSlug }}
								search={withSearch({
									month: undefined,
									from: undefined,
									to: undefined,
								})}
								className={returnLinkClass}
							>
								{preset === "week"
									? "Return to this week"
									: "Return to this month"}
							</Link>
						)
					}
				/>
			)}

			<SegmentedControl>
				{PERIOD_PRESETS.map((p) => (
					<SegmentedControlItem
						key={p.id}
						active={preset === p.id}
						render={
							<Link
								to="/$orgSlug/reports"
								params={{ orgSlug }}
								search={withSearch({
									preset: p.id,
									// Switching preset restarts from "now" in the new unit,
									// which is the only period that means the same thing in
									// all three.
									from: p.id === "custom" ? from : undefined,
									to: p.id === "custom" ? to : undefined,
								})}
							/>
						}
					>
						{p.label}
					</SegmentedControlItem>
				))}
			</SegmentedControl>

			{children && (
				<div className="ml-auto flex items-center gap-2">{children}</div>
			)}
		</div>
	);
}

function CustomRangeFields({
	orgSlug,
	search,
	from,
	to,
}: {
	orgSlug: string;
	search: Search;
	from: string;
	to: string;
}) {
	const navigate = Route.useNavigate();
	return (
		<div className="flex items-center gap-2">
			<Input
				type="date"
				className="h-8 w-36 text-xs"
				value={from}
				onChange={(e) =>
					e.target.value &&
					navigate({
						to: "/$orgSlug/reports",
						params: { orgSlug },
						search: { ...search, from: e.target.value, detailId: undefined },
					})
				}
			/>
			<span className="text-sm text-muted-foreground">to</span>
			<Input
				type="date"
				className="h-8 w-36 text-xs"
				value={to}
				onChange={(e) =>
					e.target.value &&
					navigate({
						to: "/$orgSlug/reports",
						params: { orgSlug },
						search: { ...search, to: e.target.value, detailId: undefined },
					})
				}
			/>
		</div>
	);
}

// ── Time report ─────────────────────────────────────────────────────────────

const GROUPS = [
	{ id: "clients", label: "Clients" },
	{ id: "projects", label: "Projects" },
	{ id: "teammates", label: "Teammates" },
] as const;

function TimeTab({
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
	const { data } = useSuspenseQuery(
		timeReportSummaryQuery({ from, to, tab: group }),
	);

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
				<span className="flex items-baseline gap-2 whitespace-nowrap">
					<span className="eyebrow">Total</span>
					<span className="mono text-lg">
						{formatHoursLabel(data.totalSeconds)}
					</span>
				</span>
			</div>

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

	const { data: rows } = useSuspenseQuery(timeReportDetailQuery(input));
	const { data: summary } = useSuspenseQuery(
		timeReportSummaryQuery({ from, to, tab: kind }),
	);
	const title = summary.rows.find((r) => r.id === id)?.name ?? "Detail";
	const total = rows.reduce((sum, r) => sum + r.durationSeconds, 0);

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

const formatDateHeading = (key: string) =>
	new Intl.DateTimeFormat("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	}).format(new Date(`${key}T00:00:00Z`));

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
	const clients = useSuspenseQuery(clientsQuery());
	const projects = useSuspenseQuery(projectsQuery());
	const tasks = useSuspenseQuery(selectableTasksQuery());

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

// ── The remaining reports ───────────────────────────────────────────────────

function BudgetBurnTab() {
	const { data: rows } = useSuspenseQuery(budgetBurnReportQuery());
	return (
		<>
			<ReportTable
				headers={["Project", "Client", "Logged", "Budget", "Remaining", "Burn"]}
				rows={rows.map((r) => [
					r.name,
					r.clientName,
					formatHoursLabel(r.consumedSeconds),
					r.budgetSeconds == null ? "—" : formatHoursLabel(r.budgetSeconds),
					r.remainingSeconds == null
						? "—"
						: formatHoursLabel(r.remainingSeconds),
					r.burnPct == null ? "—" : `${r.burnPct}%`,
				])}
				empty="No active fixed-scope projects — those are the only ones with an hour budget."
			/>
			<p className="mt-4 max-w-[68ch] text-sm text-muted-foreground">
				Hours only. A project's PMs and the admins get a message the first time
				it passes 80% and again at 100%; raising the budget re-arms both.
			</p>
		</>
	);
}

// PRD 6.2 — the forgetting-detector. Two lists, always shown together: "hasn't
// logged at all lately" and "logging, but behind pace". They answer different
// questions and someone can be in exactly one of them.
function ComplianceTab() {
	const { data } = useSuspenseQuery(complianceDashboardQuery());
	return (
		// Two independent lists that are always read together — stacked they cost a
		// scroll to compare, side by side on a wide screen they don't.
		<div className="grid gap-10 xl:grid-cols-2 xl:items-start xl:gap-8">
			<section className="min-w-0">
				<h2 className="eyebrow">No recent entries</h2>
				<p className="mt-2 max-w-[68ch] text-sm text-muted-foreground">
					Nothing logged in the last few working days. Overhead people are never
					listed — the system doesn't nag anyone whose hours aren't tracked
					against a fund.
				</p>
				<ReportTable
					columned
					headers={["Person", "Type", "Last entry", "Working days missing"]}
					rows={data.noEntries.map((r) => [
						r.name,
						r.memberType,
						r.lastEntryDate ?? "Never",
						String(r.workingDaysMissing),
					])}
					empty="Everyone is up to date."
				/>
			</section>

			<section className="min-w-0">
				<h2 className="eyebrow">Behind pace this month</h2>
				<p className="mt-2 max-w-[68ch] text-sm text-muted-foreground">
					Month-to-date hours against Expected prorated by the working days that
					have actually elapsed. Contractors appear only when they have an
					explicit expected-hours figure.
				</p>
				<ReportTable
					columned
					headers={["Person", "Logged", "Expected so far", "Pace", "Short by"]}
					rows={data.behindPace.map((r) => [
						r.name,
						formatHoursLabel(r.loggedSeconds),
						formatHoursLabel(r.proratedExpectedSeconds),
						`${r.pacePct}%`,
						formatHoursLabel(r.shortfallSeconds),
					])}
					empty="Nobody is behind pace."
				/>
			</section>
		</div>
	);
}

// PRD 6.7 — the monthly note to the CEO. The system drafts the list of Billable
// people with zero Final hours on client work; the Admin supplies the reason.
function NotOnInvoiceTab({ year, month }: { year: number; month: number }) {
	const { data } = useSuspenseQuery(notOnInvoiceReportQuery({ year, month }));

	if (data.finalizedCloseCount === 0) {
		return (
			<div className="border-t pt-6">
				<p className="h2">Nothing to draft yet</p>
				<p className="lede mt-2">
					No close has been finalized for this month, so everyone would show as
					un-invoiced. Finalize the month first.
				</p>
			</div>
		);
	}

	return (
		<>
			<p className="lede max-w-[68ch]">
				Billable people with zero Final hours on non-internal projects. Pick a
				reason so next month's list is comparable to this one.
			</p>
			{data.rows.length === 0 ? (
				<p className="mt-6 border-t pt-6 text-base text-muted-foreground">
					Everyone billable landed on an invoice this month.
				</p>
			) : (
				<Table containerClassName="mt-6">
					<TableHeader>
						<TableRow>
							<TableHead>Person</TableHead>
							<TableHead className="w-56">Reason</TableHead>
							<TableHead>Comment</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.rows.map((row) => (
							<NotOnInvoiceRow
								key={row.userId}
								year={year}
								month={month}
								row={row}
								statusOptions={data.statusOptions}
							/>
						))}
					</TableBody>
				</Table>
			)}
		</>
	);
}

const NO_STATUS = "__none__";

function NotOnInvoiceRow({
	year,
	month,
	row,
	statusOptions,
}: {
	year: number;
	month: number;
	row: {
		userId: string;
		name: string;
		statusOptionId: string | null;
		comment: string | null;
	};
	statusOptions: { id: string; label: string }[];
}) {
	const queryClient = useQueryClient();
	const [comment, setComment] = useState(row.comment ?? "");

	const save = useMutation({
		mutationFn: (input: {
			statusOptionId: string | null;
			comment: string | null;
		}) =>
			setNotOnInvoiceStatus({
				data: { year, month, userId: row.userId, ...input },
			}),
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: notOnInvoiceReportQuery({ year, month }).queryKey,
			}),
		onError: (error) => {
			toast.error(error.message ?? "Could not save");
			setComment(row.comment ?? "");
		},
	});

	// Base UI's Select needs `items` to resolve a value to its label.
	const items = [
		{ value: NO_STATUS, label: "—" },
		...statusOptions.map((o) => ({ value: o.id, label: o.label })),
	];

	return (
		<TableRow>
			<TableCell className="font-medium">{row.name}</TableCell>
			<TableCell>
				<Select
					items={items}
					value={row.statusOptionId ?? NO_STATUS}
					onValueChange={(value: string | null) =>
						save.mutate({
							statusOptionId:
								value == null || value === NO_STATUS ? null : value,
							comment: row.comment,
						})
					}
				>
					<SelectTrigger className="h-8 w-full">
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
			</TableCell>
			<TableCell>
				<Input
					className="h-8"
					placeholder="Optional note"
					value={comment}
					onChange={(e) => setComment(e.target.value)}
					onBlur={() => {
						if (comment === (row.comment ?? "")) return;
						save.mutate({
							statusOptionId: row.statusOptionId,
							comment: comment.trim() === "" ? null : comment.trim(),
						});
					}}
				/>
			</TableCell>
		</TableRow>
	);
}

function OvertimeTab({
	orgSlug,
	search,
	year,
	month,
}: {
	orgSlug: string;
	search: Search;
	year: number;
	month: number;
}) {
	const { data: rows } = useSuspenseQuery(overtimeReportQuery({ year, month }));

	if (search.detailKind === "overtime" && search.detailId) {
		return (
			<OvertimeDetail
				orgSlug={orgSlug}
				search={search}
				year={year}
				month={month}
				userId={search.detailId}
				name={rows.find((r) => r.userId === search.detailId)?.name ?? "Person"}
			/>
		);
	}

	if (rows.length === 0) {
		return (
			<p className="mt-1 text-base text-muted-foreground">
				Nobody flagged any overtime this month.
			</p>
		);
	}

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Person</TableHead>
					<TableHead className="text-right">This month</TableHead>
					<TableHead className="text-right">This year</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((row) => (
					<TableRow key={row.userId}>
						<TableCell className="font-medium">{row.name}</TableCell>
						<TableCell className="text-right">
							<Link
								to="/$orgSlug/reports"
								params={{ orgSlug }}
								search={{
									...search,
									detailKind: "overtime",
									detailId: row.userId,
								}}
								className="mono underlined"
							>
								{formatHoursLabel(row.monthSeconds)}
							</Link>
						</TableCell>
						<TableCell className="mono text-right">
							{formatHoursLabel(row.yearSeconds)}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

/** The entries behind one person's overtime figure (PRD 6.5) — overtime is a
 *  manual flag, so the only way to judge it is to read what was flagged. */
function OvertimeDetail({
	orgSlug,
	search,
	year,
	month,
	userId,
	name,
}: {
	orgSlug: string;
	search: Search;
	year: number;
	month: number;
	userId: string;
	name: string;
}) {
	const { data: rows } = useSuspenseQuery(
		overtimeDetailQuery({ year, month, userId }),
	);
	const total = rows.reduce((sum, r) => sum + r.durationSeconds, 0);

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
					<h2 className="h2">{name}</h2>
				</div>
				<span className="flex items-baseline gap-2">
					<span className="eyebrow">Overtime</span>
					<span className="mono text-lg">{formatHoursLabel(total)}</span>
				</span>
			</div>
			<ReportTable
				headers={["Date", "Project", "Task", "Description", "Hours"]}
				rows={rows.map((r) => [
					formatDateHeading(r.date),
					r.projectName,
					r.taskName,
					r.description,
					formatClock(r.durationSeconds),
				])}
				empty="No overtime entries this month."
			/>
		</>
	);
}

const ABSENCE_UNITS = [
	{ id: "hours", label: "Hours" },
	{ id: "days", label: "Days" },
] as const;

function AbsenceTab({ year, month }: { year: number; month: number }) {
	const { data } = useSuspenseQuery(absenceReportQuery({ year, month }));
	const [unit, setUnit] = useState<"hours" | "days">("hours");

	const format = (seconds: number) =>
		unit === "hours"
			? formatHoursLabel(seconds)
			: formatDaysLabel(seconds, data.workingDaySeconds);

	// The columns are whatever absence tasks the site defines, named by the
	// service. This used to read `byTask["Vacation"]` and `byTask["Sick Leave"]`
	// — display names, which meant a third kind of absence was invisible here and
	// a rename would have emptied both columns without failing anything.
	const cell = (byTask: Record<string, number>, key: string) =>
		format(byTask[key] ?? 0);

	return (
		<>
			<div className="flex items-center justify-between gap-3">
				<p className="max-w-[68ch] text-sm text-muted-foreground">
					Vacation and Sick Leave, this month and year to date. Counted from
					logged entries only — if this disagrees with a close sheet's absence
					column, someone forgot to log their time off, and that gap is the
					point.
				</p>
				<SegmentedControl>
					{ABSENCE_UNITS.map((u) => (
						// A plain state tab, not navigation: the unit is a way of reading
						// the same numbers, so it has no business in the URL.
						<SegmentedControlItem
							key={u.id}
							active={unit === u.id}
							onClick={() => setUnit(u.id)}
						>
							{u.label}
						</SegmentedControlItem>
					))}
				</SegmentedControl>
			</div>

			{data.rows.length === 0 ? (
				<p className="mt-5 border-t pt-5 text-base text-muted-foreground">
					No absence logged this year.
				</p>
			) : (
				<Table containerClassName="mt-6">
					<TableHeader>
						<TableRow>
							<TableHead>Person</TableHead>
							{data.columns.map((c) => (
								<TableHead key={`m-${c.key}`} className="text-right">
									{c.label} (month)
								</TableHead>
							))}
							<TableHead className="text-right">Month</TableHead>
							{data.columns.map((c) => (
								<TableHead key={`y-${c.key}`} className="text-right">
									{c.label} (YTD)
								</TableHead>
							))}
							<TableHead className="text-right">Year to date</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.rows.map((row) => (
							<TableRow key={row.userId}>
								<TableCell className="font-medium">{row.name}</TableCell>
								{data.columns.map((c) => (
									<TableCell key={`m-${c.key}`} className="mono text-right">
										{cell(row.monthByTask, c.key)}
									</TableCell>
								))}
								<TableCell className="mono text-right font-medium">
									{format(row.monthSeconds)}
								</TableCell>
								{data.columns.map((c) => (
									<TableCell key={`y-${c.key}`} className="mono text-right">
										{cell(row.ytdByTask, c.key)}
									</TableCell>
								))}
								<TableCell className="mono text-right font-medium">
									{format(row.ytdSeconds)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}
		</>
	);
}

const TREND_MONTHS = 6;

function VarianceTab({ year, month }: { year: number; month: number }) {
	const { data: rows } = useSuspenseQuery(varianceReportQuery({ year, month }));
	const { data: trend } = useSuspenseQuery(
		varianceTrendQuery({ year, month, months: TREND_MONTHS }),
	);

	// Chronic undertracking is a pattern, not a month: the trend is a person ×
	// month grid of the same difference, so a column of red belongs to one person
	// rather than to a bad month.
	const people = new Map<string, string>();
	for (const period of trend) {
		for (const row of period.rows) people.set(row.userId, row.name);
	}
	const byPeriod = trend.map((p) => ({
		label: `${String(p.month).padStart(2, "0")}/${String(p.year).slice(2)}`,
		byUser: new Map(p.rows.map((r) => [r.userId, r])),
	}));

	return (
		<>
			<ReportTable
				headers={["Person", "Reported", "Final", "Difference"]}
				rows={rows.map((r) => [
					r.name,
					formatHoursLabel(r.reportedSeconds),
					formatHoursLabel(r.finalSeconds),
					r.diffPct == null
						? formatHoursLabel(r.diffSeconds)
						: `${r.diffPct > 0 ? "+" : ""}${r.diffPct}%`,
				])}
				empty="No month has been finalized yet, so there's nothing to compare."
			/>
			<p className="mt-4 max-w-[68ch] text-sm text-muted-foreground">
				Reported is frozen at the moment the month was finalized, so later edits
				to entries can't quietly move the comparison.
			</p>

			{people.size > 0 && (
				<section className="-mx-4 mt-7 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
					<h2 className="eyebrow">Last {TREND_MONTHS} months</h2>
					<p className="mt-2 max-w-[68ch] text-sm text-muted-foreground">
						Final against Reported, per person per month. A positive number
						means the PM adjusted them up — the signature of somebody who works
						the month and forgets to write it down.
					</p>
					<Table containerClassName="mt-5">
						<TableHeader>
							<TableRow>
								<TableHead>Person</TableHead>
								{byPeriod.map((p) => (
									<TableHead key={p.label} className="text-right">
										{p.label}
									</TableHead>
								))}
							</TableRow>
						</TableHeader>
						<TableBody>
							{[...people.entries()]
								.sort((a, b) => a[1].localeCompare(b[1]))
								.map(([userId, name]) => (
									<TableRow key={userId}>
										<TableCell className="font-medium">{name}</TableCell>
										{byPeriod.map((p) => {
											const row = p.byUser.get(userId);
											return (
												<TableCell
													key={p.label}
													className={cn(
														"mono text-right",
														row && row.diffSeconds > 0 && "text-warn",
													)}
												>
													{row?.diffPct == null
														? "—"
														: `${row.diffPct > 0 ? "+" : ""}${row.diffPct}%`}
												</TableCell>
											);
										})}
									</TableRow>
								))}
						</TableBody>
					</Table>
				</section>
			)}
		</>
	);
}

function UtilizationTab({ year, month }: { year: number; month: number }) {
	const { data: rows } = useSuspenseQuery(
		utilizationReportQuery({ year, month }),
	);
	const { data: trend } = useSuspenseQuery(
		utilizationTrendQuery({ year, month, months: TREND_MONTHS }),
	);

	// The same roll-up the PDF headline and every trend point use, so the three
	// can no longer disagree. See `@farmer/core/lib/utilization`.
	const totals = rollUpUtilization(rows);

	return (
		<>
			<div className="flex flex-wrap items-baseline justify-between gap-3">
				<p className="max-w-[68ch] text-sm text-muted-foreground">
					Final hours on non-internal projects, over expected hours. Overhead
					people are excluded; contractors without an expected figure show hours
					but no percentage, and count toward neither side of the org figure —
					which is total final over total expected, not an average of the rows.
				</p>
				<span className="flex items-baseline gap-2 whitespace-nowrap">
					<span className="eyebrow">Org utilization</span>
					<span className="mono text-lg">
						{formatPctLabel(totals.utilizationPct)}
					</span>
				</span>
			</div>

			<ReportTable
				headers={["Person", "Type", "Final", "Expected", "Utilization"]}
				rows={rows.map((r) => [
					r.name,
					r.memberType,
					formatHoursLabel(r.finalSeconds),
					r.expectedSeconds == null ? "—" : formatHoursLabel(r.expectedSeconds),
					formatPctLabel(r.utilizationPct),
				])}
				empty="No finalized months yet."
			/>

			{trend.some((t) => t.utilizationPct != null) && (
				<section className="-mx-4 mt-7 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
					<h2 className="eyebrow">Last {TREND_MONTHS} months</h2>
					<Table containerClassName="mt-5">
						<TableHeader>
							<TableRow>
								<TableHead>Month</TableHead>
								<TableHead className="text-right">People measured</TableHead>
								<TableHead className="text-right">Invoiced hours</TableHead>
								<TableHead className="text-right">Utilization</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{trend.map((t) => (
								<TableRow key={`${t.year}-${t.month}`}>
									<TableCell className="font-medium">
										{formatMonthKey(
											`${t.year}-${String(t.month).padStart(2, "0")}`,
										)}
									</TableCell>
									<TableCell className="mono text-right">
										{t.peopleMeasured}
									</TableCell>
									<TableCell className="mono text-right">
										{formatHoursLabel(t.finalSeconds)}
									</TableCell>
									<TableCell className="mono text-right">
										{formatPctLabel(t.utilizationPct)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</section>
			)}
		</>
	);
}

// One table shape for the tabs that are simply "a list of people or projects
// with a few numbers" — giving each its own table would be six copies of the
// same markup. The two that aren't (Time, Absence) build their own.
function ReportTable({
	headers,
	rows,
	empty,
	// Set by a tab that puts its tables side by side at xl (Tracking). Up to that
	// point the table bleeds edge-to-edge like every other table in the app; once
	// the grid splits, the negative margin would run each table under its
	// neighbour, so from xl it sits inside its own column instead.
	columned = false,
}: {
	headers: string[];
	rows: string[][];
	empty: string;
	columned?: boolean;
}) {
	if (rows.length === 0) {
		// An empty report is a sentence on the page, not a dashed box: a dashed
		// rectangle is a drop target, and nothing here can be dropped into.
		return (
			<p className="mt-5 border-t pt-5 text-base text-muted-foreground">
				{empty}
			</p>
		);
	}
	return (
		<Table
			className={cn(
				columned &&
					"xl:[&_td:first-child]:pl-2 xl:[&_td:last-child]:pr-2 xl:[&_th:first-child]:pl-2 xl:[&_th:last-child]:pr-2",
			)}
			containerClassName={cn("mt-6", columned && "xl:mx-0")}
		>
			<TableHeader>
				<TableRow>
					{headers.map((h, i) => (
						<TableHead key={h} className={cn(i > 0 && "text-right")}>
							{h}
						</TableHead>
					))}
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((cells) => (
					<TableRow key={cells.join("|")}>
						{cells.map((cell, i) => (
							<TableCell
								key={`${cells[0]}-${headers[i]}`}
								className={cn(i === 0 ? "font-medium" : "mono text-right")}
							>
								{cell}
							</TableCell>
						))}
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
