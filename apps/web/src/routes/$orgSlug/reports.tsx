import {
	addDaysToKey,
	dayKeyInTz,
	startOfWeekKey,
} from "@farmer/core/lib/time";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, FileDown } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { Button } from "#/components/ui/button.tsx";
import { FadeSwap } from "#/components/ui/fade-swap.tsx";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/ui/segmented-control.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { formatHoursShort } from "#/lib/format-hours.ts";
import {
	budgetsAndMarginReportQuery,
	utilizationReportQuery,
} from "#/queries/reports.ts";
import { requireOrgAdmin } from "#/server/auth.ts";

const searchSchema = z.object({
	weekStart: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
});

export const Route = createFileRoute("/$orgSlug/reports")({
	validateSearch: searchSchema,
	loaderDeps: ({ search }) => ({ weekStart: search.weekStart }),
	beforeLoad: async () => {
		await requireOrgAdmin();
	},
	loader: async ({ context, deps }) => {
		const weekStart =
			deps.weekStart ??
			startOfWeekKey(dayKeyInTz(new Date(), context.organization.timezone));
		const weekEnd = addDaysToKey(weekStart, 6);
		await Promise.all([
			context.queryClient.ensureQueryData(
				utilizationReportQuery({ from: weekStart, to: weekEnd }),
			),
			context.queryClient.ensureQueryData(budgetsAndMarginReportQuery()),
		]);
	},
	component: ReportsPage,
});

const formatCurrency = (amount: number, currency: string) =>
	new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
		amount,
	);

function UtilizationTab() {
	const { organization } = Route.useRouteContext();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const weekStart =
		search.weekStart ??
		startOfWeekKey(dayKeyInTz(new Date(), organization.timezone));
	const weekEnd = addDaysToKey(weekStart, 6);
	const { data: rows } = useSuspenseQuery(
		utilizationReportQuery({ from: weekStart, to: weekEnd }),
	);

	const goToWeek = (next: string) => navigate({ search: { weekStart: next } });

	return (
		<div>
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="icon-sm"
					onClick={() => goToWeek(addDaysToKey(weekStart, -7))}
					aria-label="Previous week"
				>
					<ChevronLeft className="size-4" />
				</Button>
				<span className="min-w-[150px] text-center text-[13px] font-semibold">
					{weekStart} – {weekEnd}
				</span>
				<Button
					variant="outline"
					size="icon-sm"
					onClick={() => goToWeek(addDaysToKey(weekStart, 7))}
					aria-label="Next week"
				>
					<ChevronRight className="size-4" />
				</Button>
			</div>

			{rows.length === 0 ? (
				<p className="mt-6 text-sm text-muted-foreground">No members yet.</p>
			) : (
				<Table
					className="border-t [&_td:first-child]:pl-8 [&_td:last-child]:pr-8 [&_th:first-child]:pl-8 [&_th:last-child]:pr-8"
					containerClassName="-mx-4 mt-6 border-b sm:-mx-8"
				>
					<TableHeader>
						<TableRow>
							<TableHead>Member</TableHead>
							<TableHead>Expected</TableHead>
							<TableHead>Logged</TableHead>
							<TableHead>Utilization</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((row) => (
							<TableRow key={row.userId}>
								<TableCell className="font-medium">{row.name}</TableCell>
								<TableCell className="tnum">
									{formatHoursShort(row.expectedSeconds)}
								</TableCell>
								<TableCell className="tnum">
									{formatHoursShort(row.loggedSeconds)}
								</TableCell>
								<TableCell>
									{row.utilizationPct === null ? (
										<span className="text-muted-foreground">—</span>
									) : (
										<div className="flex items-center gap-2">
											<div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
												<div
													className="h-full rounded-full bg-primary"
													style={{
														width: `${Math.min(row.utilizationPct, 100)}%`,
													}}
												/>
											</div>
											<span className="tnum text-xs text-muted-foreground">
												{row.utilizationPct}%
											</span>
										</div>
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}
		</div>
	);
}

function BudgetsAndMarginTab() {
	const { data: rows } = useSuspenseQuery(budgetsAndMarginReportQuery());

	if (rows.length === 0) {
		return (
			<p className="mt-6 text-sm text-muted-foreground">
				No active projects yet.
			</p>
		);
	}

	return (
		<Table
			className="border-t [&_td:first-child]:pl-8 [&_td:last-child]:pr-8 [&_th:first-child]:pl-8 [&_th:last-child]:pr-8"
			containerClassName="-mx-4 mt-6 border-b sm:-mx-8"
		>
			<TableHeader>
				<TableRow>
					<TableHead>Project</TableHead>
					<TableHead>Budget</TableHead>
					<TableHead>Revenue</TableHead>
					<TableHead>Cost</TableHead>
					<TableHead>Margin</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((row) => (
					<TableRow key={row.projectId}>
						<TableCell className="font-medium">{row.name}</TableCell>
						<TableCell>
							{row.budgetSeconds === null && row.budgetAmount === null ? (
								<span className="text-muted-foreground">—</span>
							) : (
								<div className="space-y-1">
									{row.budgetSeconds !== null && (
										<div className="text-xs">
											{formatHoursShort(row.actualSeconds)} /{" "}
											{formatHoursShort(row.budgetSeconds)}
											{row.budgetSecondsPct !== null && (
												<span className="ml-1 text-muted-foreground">
													({row.budgetSecondsPct}%)
												</span>
											)}
										</div>
									)}
									{row.budgetAmount !== null && (
										<div className="text-xs">
											{formatCurrency(row.revenue, row.currency)} /{" "}
											{formatCurrency(row.budgetAmount, row.currency)}
											{row.budgetAmountPct !== null && (
												<span className="ml-1 text-muted-foreground">
													({row.budgetAmountPct}%)
												</span>
											)}
										</div>
									)}
								</div>
							)}
						</TableCell>
						<TableCell className="tnum">
							{formatCurrency(row.revenue, row.currency)}
						</TableCell>
						<TableCell className="tnum">
							{formatCurrency(row.cost, row.currency)}
						</TableCell>
						<TableCell className="tnum">
							{formatCurrency(row.margin, row.currency)}
							{row.marginPct !== null && (
								<span className="ml-1 text-xs text-muted-foreground">
									({row.marginPct}%)
								</span>
							)}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

function ReportsPage() {
	const { organization } = Route.useRouteContext();
	const search = Route.useSearch();
	const [tab, setTab] = useState<"utilization" | "budgets">("utilization");
	const weekStart =
		search.weekStart ??
		startOfWeekKey(dayKeyInTz(new Date(), organization.timezone));
	const weekEnd = addDaysToKey(weekStart, 6);

	return (
		<div className="page-shell">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="font-display text-xl">Reports</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Team utilization and project budgets &amp; margin.
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					nativeButton={false}
					render={
						// Plain navigation (not fetch) so the browser handles the
						// download; the route is session-cookie authed.
						<a href={`/api/reports/pdf?from=${weekStart}&to=${weekEnd}`}>
							<FileDown className="size-4" />
							Download PDF
						</a>
					}
				/>
			</div>

			<div className="mt-6">
				<SegmentedControl role="tablist">
					<SegmentedControlItem
						role="tab"
						aria-selected={tab === "utilization"}
						active={tab === "utilization"}
						onClick={() => setTab("utilization")}
					>
						Utilization
					</SegmentedControlItem>
					<SegmentedControlItem
						role="tab"
						aria-selected={tab === "budgets"}
						active={tab === "budgets"}
						onClick={() => setTab("budgets")}
					>
						Budgets &amp; Margin
					</SegmentedControlItem>
				</SegmentedControl>
				<FadeSwap activeKey={tab} className="mt-4">
					{tab === "utilization" ? <UtilizationTab /> : <BudgetsAndMarginTab />}
				</FadeSwap>
			</div>
		</div>
	);
}
