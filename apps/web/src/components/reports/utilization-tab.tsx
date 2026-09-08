import {
	formatHoursLabel,
	formatPctLabel,
} from "@farmer/core/lib/report-format";
import { rollUpUtilization } from "@farmer/core/lib/utilization";
import { useSuspenseQuery } from "@tanstack/react-query";

import { PersonCell } from "#/components/person-avatar.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { formatMonthKey } from "#/lib/format-date.ts";
import {
	utilizationReportQuery,
	utilizationTrendQuery,
} from "#/queries/reports.ts";

import { ReportTable, TREND_MONTHS } from "./shared.tsx";

export function UtilizationTab({
	year,
	month,
}: {
	year: number;
	month: number;
}) {
	const orgSlug = useOrgSlug();
	const { data: rows } = useSuspenseQuery(
		utilizationReportQuery(orgSlug, { year, month }),
	);
	const { data: trend } = useSuspenseQuery(
		utilizationTrendQuery(orgSlug, { year, month, months: TREND_MONTHS }),
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
				rows={rows.map((r) => ({
					key: r.userId,
					cells: [
						<PersonCell key="person" userId={r.userId} name={r.name} />,
						r.memberType,
						formatHoursLabel(r.finalSeconds),
						r.expectedSeconds == null
							? "—"
							: formatHoursLabel(r.expectedSeconds),
						formatPctLabel(r.utilizationPct),
					],
				}))}
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
