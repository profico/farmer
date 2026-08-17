import { formatHoursLabel } from "@farmer/core/lib/report-format";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { returnLinkClass } from "#/components/time/time-toolbar.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { formatClock } from "#/lib/format-hours.ts";
import { overtimeDetailQuery, overtimeReportQuery } from "#/queries/reports.ts";
import type { Search } from "./search.ts";
import { formatDateHeading, ReportTable } from "./shared.tsx";

export function OvertimeTab({
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
	const { data: rows } = useSuspenseQuery(
		overtimeReportQuery(orgSlug, { year, month }),
	);

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
		overtimeDetailQuery(orgSlug, { year, month, userId }),
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
