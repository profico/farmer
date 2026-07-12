import { formatDayKey } from "@farmer/core/lib/time";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";
import {
	type DecideRequest,
	DecideTimeOffDialog,
} from "#/components/decide-time-off-dialog.tsx";
import { TimeOffPolicyAdmin } from "#/components/time-off-policy-admin.tsx";
import { TimeOffStatusPill } from "#/components/time-off-status-pill.tsx";
import { Button } from "#/components/ui/button.tsx";
import { FadeSwap } from "#/components/ui/fade-swap.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { TablePagination } from "#/components/ui/table-pagination.tsx";
import { useTableSearch } from "#/lib/use-table-search.ts";
import { cn } from "#/lib/utils.ts";
import { allTimeOffQuery } from "#/queries/time-off.ts";
import {
	memberAllowancesQuery,
	timeOffPolicyQuery,
} from "#/queries/time-off-policy.ts";
import { getIsTimeOffApprover } from "#/server/time-off.ts";

const REQUESTS_PAGE_SIZE = 15;

export const Route = createFileRoute("/$orgSlug/settings/time-off")({
	beforeLoad: async ({ context, params }) => {
		const isAdmin = context.role === "owner" || context.role === "admin";
		if (!isAdmin) {
			const approver = await getIsTimeOffApprover();
			if (!approver) {
				throw redirect({
					to: "/$orgSlug",
					params: { orgSlug: params.orgSlug },
				});
			}
		}
		return { isAdmin };
	},
	loader: async ({ context }) => {
		const tasks: Promise<unknown>[] = [
			context.queryClient.ensureQueryData(allTimeOffQuery()),
		];
		if (context.isAdmin) {
			tasks.push(
				context.queryClient.ensureQueryData(timeOffPolicyQuery()),
				context.queryClient.ensureQueryData(memberAllowancesQuery()),
			);
		}
		await Promise.all(tasks);
	},
	component: TimeOffSettingsPage,
});

type StatusFilter = "all" | "pending" | "approved" | "denied";
const FILTERS: StatusFilter[] = ["all", "pending", "approved", "denied"];

function TimeOffSettingsPage() {
	const { isAdmin } = Route.useRouteContext();
	const [filter, setFilter] = useState<StatusFilter>("all");
	const [reviewing, setReviewing] = useState<DecideRequest | null>(null);
	const { data: requests = [], isFetching } = useQuery(
		allTimeOffQuery(filter === "all" ? undefined : filter),
	);

	const {
		search,
		setSearch,
		paged,
		page,
		setPage,
		pageCount,
		total,
		from,
		to,
	} = useTableSearch(
		requests,
		(r) =>
			`${r.user.name} ${r.type} ${r.reviewer?.name ?? "Any"} ${r.label ?? ""} ${r.decisionNote ?? ""}`,
		REQUESTS_PAGE_SIZE,
	);

	return (
		<div className="page-shell">
			<h1 className="font-display text-xl">Time off requests</h1>

			<div className="mt-6 flex flex-wrap items-center justify-between gap-3">
				<div className="flex gap-1.5">
					{FILTERS.map((f) => (
						<button
							key={f}
							type="button"
							onClick={() => setFilter(f)}
							className={cn(
								"rounded-4xl border px-3 py-1 text-sm font-medium capitalize transition-colors",
								filter === f
									? "border-primary bg-primary text-primary-foreground"
									: "border-border text-muted-foreground hover:text-foreground",
							)}
						>
							{f}
						</button>
					))}
				</div>
				{requests.length > 0 && (
					<div className="relative w-full sm:w-64">
						<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search requests…"
							className="w-full pl-8"
						/>
					</div>
				)}
			</div>

			<FadeSwap activeKey={filter}>
				{requests.length === 0 ? (
					<p className="mt-6 text-sm text-muted-foreground">
						No time off requests.
					</p>
				) : (
					<>
						<Table
							className={cn(
								"border-t transition-opacity duration-150 [&_td:first-child]:pl-8 [&_td:last-child]:pr-8 [&_th:first-child]:pl-8 [&_th:last-child]:pr-8",
								isFetching && "opacity-60",
							)}
							containerClassName="-mx-4 mt-6 border-b sm:-mx-8"
						>
							<TableHeader>
								<TableRow>
									<TableHead>Requester</TableHead>
									<TableHead>Dates</TableHead>
									<TableHead>Type</TableHead>
									<TableHead>Reviewer</TableHead>
									<TableHead>Note</TableHead>
									<TableHead>Status</TableHead>
									<TableHead />
								</TableRow>
							</TableHeader>
							<TableBody>
								{paged.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={7}
											className="py-8 text-center text-sm text-muted-foreground"
										>
											No requests match your search.
										</TableCell>
									</TableRow>
								) : (
									paged.map((r) => (
										<TableRow key={r.id}>
											<TableCell className="font-medium">
												{r.user.name}
											</TableCell>
											<TableCell>
												{r.startDate === r.endDate
													? formatDayKey(r.startDate)
													: `${formatDayKey(r.startDate, { year: false })} – ${formatDayKey(r.endDate)}`}
											</TableCell>
											<TableCell className="capitalize">{r.type}</TableCell>
											<TableCell className="text-muted-foreground">
												{r.reviewer?.name ?? "Any"}
											</TableCell>
											<TableCell className="max-w-40 truncate text-muted-foreground">
												{r.status === "pending"
													? (r.label ?? "—")
													: (r.decisionNote ?? r.label ?? "—")}
											</TableCell>
											<TableCell>
												<TimeOffStatusPill status={r.status} />
											</TableCell>
											<TableCell className="text-right">
												{r.status === "pending" && (
													<Button
														variant="outline"
														size="sm"
														onClick={() =>
															setReviewing({
																id: r.id,
																requesterName: r.user.name,
																startDate: r.startDate,
																endDate: r.endDate,
																type: r.type,
																label: r.label,
															})
														}
													>
														Review
													</Button>
												)}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
						<TablePagination
							page={page}
							pageCount={pageCount}
							total={total}
							from={from}
							to={to}
							onPageChange={setPage}
						/>
					</>
				)}
			</FadeSwap>

			<DecideTimeOffDialog
				request={reviewing}
				onOpenChange={(open) => !open && setReviewing(null)}
			/>

			{isAdmin && <TimeOffPolicyAdmin />}
		</div>
	);
}
