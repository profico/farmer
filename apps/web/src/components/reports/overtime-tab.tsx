import {
	formatDecimalHours,
	formatReportHours,
} from "@farmer/core/lib/report-format";
import { resolveReportPeriod } from "@farmer/core/lib/report-period";
import { matchesSearch } from "@farmer/core/lib/search";
import type { OvertimeReportInput } from "@farmer/core/schema";
import type { OvertimeRow } from "@farmer/core/services";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Fragment, Suspense, useState } from "react";

import { PersonCell } from "#/components/person-avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { NoMatchesRow, SearchInput } from "#/components/ui/search-input.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { useWeekStartsOn } from "#/hooks/use-week-starts-on.ts";
import { cn } from "#/lib/utils.ts";
import { overtimeReportQuery } from "#/queries/reports.ts";

import type { Search } from "./search.ts";
import {
	ActiveOnlyToggle,
	byNumber,
	byText,
	ExportMenu,
	FigurePending,
	formatDateHeading,
	PeriodPicker,
	RowDisclosure,
	type Sort,
	SortHead,
	TabPending,
	toggleSort,
} from "./shared.tsx";

// The Overtime report (PRD 6.5), as the COO signed it off: the same period
// control as the Time report, one table of people with their flagged entries
// and hours, and a row that opens into the entries — date, project, task,
// note. Only what a person flagged as overtime when logging it; nothing is
// inferred from the fund.

export function OvertimeTab({
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
	const navigate = useNavigate({ from: "/$orgSlug/reports" });
	const weekStartsOn = useWeekStartsOn();
	const { from, to } = resolveReportPeriod(search, today, weekStartsOn);
	const input: OvertimeReportInput = {
		from,
		to,
		activeOnly: search.active === "1",
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
							Export
						</Button>
					}
				>
					<OvertimeExport input={input} />
				</Suspense>
			</PeriodPicker>

			<Suspense
				fallback={
					<>
						<div className="mt-6 flex justify-end">
							<FigurePending label="Total hours" />
						</div>
						<TabPending className="mt-6" />
					</>
				}
			>
				<OvertimeRows input={input} />
			</Suspense>
		</>
	);
}

function OvertimeExport({ input }: { input: OvertimeReportInput }) {
	const orgSlug = useOrgSlug();
	const { data } = useSuspenseQuery(overtimeReportQuery(orgSlug, input));
	return (
		<ExportMenu
			disabled={data.rows.length === 0}
			filename={`overtime_${input.from}_${input.to}`}
			csv={() => ({
				headers: ["Person", "Entries", "Hours"],
				rows: data.rows.map((r) => [
					r.name,
					String(r.count),
					formatDecimalHours(r.seconds),
				]),
			})}
			pdf={() => ({
				title: "Overtime report",
				from: input.from,
				to: input.to,
				total: formatReportHours(
					data.rows.reduce((sum, r) => sum + r.seconds, 0),
				),
				facts: input.activeOnly ? [["Projects", "Active only"]] : [],
				columns: [
					{ label: "Person" },
					{ label: "Entries", align: "right" },
					{ label: "Hours", align: "right" },
				],
				groups: [
					{
						rows: [...data.rows]
							.sort((a, b) => b.seconds - a.seconds)
							.map((r) => ({
								cells: [r.name, String(r.count), formatReportHours(r.seconds)],
							})),
					},
				],
			})}
		/>
	);
}

type SortKey = "name" | "count" | "hours";

function OvertimeRows({ input }: { input: OvertimeReportInput }) {
	const orgSlug = useOrgSlug();
	const { data } = useSuspenseQuery(overtimeReportQuery(orgSlug, input));
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
	const [sort, setSort] = useState<Sort<SortKey>>({ key: "hours", dir: -1 });
	const onSort = (key: SortKey, numeric: boolean) =>
		setSort((current) => toggleSort(current, key, numeric));
	const compare = {
		name: byText((r: OvertimeRow) => r.name),
		count: byNumber((r: OvertimeRow) => r.count),
		hours: byNumber((r: OvertimeRow) => r.seconds),
	} satisfies Record<SortKey, (a: OvertimeRow, b: OvertimeRow) => number>;
	const toggle = (userId: string) =>
		setOpen((current) => {
			const next = new Set(current);
			if (next.has(userId)) next.delete(userId);
			else next.add(userId);
			return next;
		});

	const shown = data.rows
		.filter((row) => matchesSearch(query, [row.name]))
		.sort(
			(a, b) =>
				compare[sort.key](a, b) * sort.dir ||
				a.name.localeCompare(b.name, "hr"),
		);

	return (
		<>
			<div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
				<SearchInput
					value={query}
					onValueChange={setQuery}
					className="w-full sm:w-56"
				/>
				<span className="flex items-baseline gap-2 whitespace-nowrap">
					<span className="eyebrow">Total hours</span>
					<span className="mono text-lg">
						{formatReportHours(data.totalSeconds)}
					</span>
					<span className="text-xs text-muted-foreground">
						{data.totalEntries.toLocaleString("hr-HR")} flagged{" "}
						{data.totalEntries === 1 ? "entry" : "entries"} · {data.rows.length}{" "}
						{data.rows.length === 1 ? "person" : "people"}
					</span>
				</span>
			</div>

			{data.rows.length === 0 ? (
				<p className="mt-5 border-t pt-5 text-base text-muted-foreground">
					No overtime flagged in this period.
				</p>
			) : (
				<Table containerClassName="mt-3">
					<TableHeader>
						<TableRow>
							<SortHead
								label="Name"
								sortKey="name"
								sort={sort}
								onSort={onSort}
							/>
							<SortHead
								label="Entries"
								sortKey="count"
								numeric
								sort={sort}
								onSort={onSort}
								className="text-right"
							/>
							<SortHead
								label="Overtime hours"
								sortKey="hours"
								numeric
								sort={sort}
								onSort={onSort}
								className="text-right"
							/>
						</TableRow>
					</TableHeader>
					<TableBody>
						{shown.length === 0 ? (
							<NoMatchesRow colSpan={3} />
						) : (
							shown.map((row) => {
								const isOpen = open.has(row.userId);
								return (
									<Fragment key={row.userId}>
										<TableRow>
											<TableCell className="p-0">
												<RowDisclosure
													open={isOpen}
													onToggle={() => toggle(row.userId)}
												>
													<PersonCell userId={row.userId} name={row.name} />
												</RowDisclosure>
											</TableCell>
											<TableCell className="mono text-right text-muted-foreground">
												{row.count}
											</TableCell>
											<TableCell className="mono text-right">
												{formatReportHours(row.seconds)}
											</TableCell>
										</TableRow>
										{isOpen &&
											row.entries.map((e) => (
												<TableRow key={e.id}>
													<TableCell className="pl-7 whitespace-normal">
														{formatDateHeading(e.date)}
														<span className="text-muted-foreground">
															{" "}
															·{" "}
															{e.projectCode && (
																<span className="mono text-xs">
																	[{e.projectCode}]{" "}
																</span>
															)}
															{e.projectName} · {e.taskName}
														</span>
														<span
															className={cn(
																"block text-xs",
																e.description
																	? "text-muted-foreground"
																	: "text-faint italic",
															)}
														>
															{e.description || "No description"}
														</span>
													</TableCell>
													<TableCell />
													<TableCell className="mono text-right">
														{formatReportHours(e.durationSeconds)}
													</TableCell>
												</TableRow>
											))}
									</Fragment>
								);
							})
						)}
						<TableRow className="bg-secondary/60 hover:bg-secondary/60">
							<TableCell className="font-medium">Total</TableCell>
							<TableCell className="mono text-right font-medium text-muted-foreground">
								{data.totalEntries}
							</TableCell>
							<TableCell className="mono text-right font-medium">
								{formatReportHours(data.totalSeconds)}
							</TableCell>
						</TableRow>
					</TableBody>
				</Table>
			)}

			<p className="mt-3 max-w-[72ch] text-sm text-muted-foreground">
				<span className="font-medium text-foreground">
					How it's calculated.
				</span>{" "}
				Only entries flagged as overtime. Nothing comes from the hour fund.
			</p>
		</>
	);
}
