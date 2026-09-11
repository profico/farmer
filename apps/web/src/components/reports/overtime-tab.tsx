import { formatHoursLabel } from "@farmer/core/lib/report-format";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { PersonCell } from "#/components/person-avatar.tsx";
import { returnLinkClass } from "#/components/time/time-toolbar.tsx";
import { NoMatchesRow, SearchInput } from "#/components/ui/search-input.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { formatClock } from "#/lib/format-hours.ts";
import { matchesSearch } from "#/lib/search.ts";
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
	const [query, setQuery] = useState("");
	const filteredRows = rows.filter((row) => matchesSearch(query, [row.name]));

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
		<>
			<SearchInput
				value={query}
				onValueChange={setQuery}
				className="w-full sm:w-56"
			/>
			<Table containerClassName="mt-3">
				<TableHeader>
					<TableRow>
						<TableHead>Person</TableHead>
						<TableHead className="text-right">This month</TableHead>
						<TableHead className="text-right">This year</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{filteredRows.length === 0 ? (
						<NoMatchesRow colSpan={3} />
					) : (
						filteredRows.map((row) => (
							<TableRow key={row.userId}>
								<TableCell>
									<PersonCell userId={row.userId} name={row.name} />
								</TableCell>
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
						))
					)}
				</TableBody>
			</Table>
		</>
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
	// Over every row, not whatever the table's own search box narrows to.
	const total = rows.reduce((sum, r) => sum + r.durationSeconds, 0);

	return (
		<>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<Link
						to="/$orgSlug/reports"
						params={{ orgSlug }}
						search={{ ...search, detailId: undefined, detailKind: undefined }}
						className={`${returnLinkClass} inline-flex items-center gap-1`}
					>
						<ArrowLeftIcon weight="regular" className="size-3.5" />
						Back
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
				rows={rows.map((r) => ({
					key: r.id,
					cells: [
						formatDateHeading(r.date),
						r.projectName,
						r.taskName,
						r.description,
						formatClock(r.durationSeconds),
					],
					searchFields: [r.projectName, r.taskName, r.description],
				}))}
				empty="No overtime entries this month."
			/>
		</>
	);
}
