import { formatHoursLabel } from "@farmer/core/lib/report-format";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PersonCell } from "#/components/person-avatar.tsx";
import { NoMatchesRow, SearchInput } from "#/components/ui/search-input.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { matchesSearch } from "#/lib/search.ts";
import { cn } from "#/lib/utils.ts";
import { varianceReportQuery, varianceTrendQuery } from "#/queries/reports.ts";

import { ReportTable, TREND_MONTHS } from "./shared.tsx";

export function VarianceTab({ year, month }: { year: number; month: number }) {
	const orgSlug = useOrgSlug();
	const { data: rows } = useSuspenseQuery(
		varianceReportQuery(orgSlug, { year, month }),
	);
	const { data: trend } = useSuspenseQuery(
		varianceTrendQuery(orgSlug, { year, month, months: TREND_MONTHS }),
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

	// The trend's rows are people, not the fixed run of months across the top —
	// with enough people on the org this is exactly the list search exists for.
	const [trendQuery, setTrendQuery] = useState("");
	const sortedPeople = [...people.entries()].sort((a, b) =>
		a[1].localeCompare(b[1]),
	);
	const filteredPeople = sortedPeople.filter(([, name]) =>
		matchesSearch(trendQuery, [name]),
	);

	return (
		<>
			<ReportTable
				headers={["Person", "Reported", "Final", "Difference"]}
				rows={rows.map((r) => ({
					key: r.userId,
					cells: [
						<PersonCell key="person" userId={r.userId} name={r.name} />,
						formatHoursLabel(r.reportedSeconds),
						formatHoursLabel(r.finalSeconds),
						r.diffPct == null
							? formatHoursLabel(r.diffSeconds)
							: `${r.diffPct > 0 ? "+" : ""}${r.diffPct}%`,
					],
					searchFields: [r.name],
				}))}
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
					<SearchInput
						value={trendQuery}
						onValueChange={setTrendQuery}
						className="mt-5 w-full sm:w-56"
					/>
					<Table containerClassName="mt-3">
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
							{filteredPeople.length === 0 ? (
								<NoMatchesRow colSpan={byPeriod.length + 1} />
							) : (
								filteredPeople.map(([userId, name]) => (
									<TableRow key={userId}>
										<TableCell>
											<PersonCell userId={userId} name={name} />
										</TableCell>
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
								))
							)}
						</TableBody>
					</Table>
				</section>
			)}
		</>
	);
}
