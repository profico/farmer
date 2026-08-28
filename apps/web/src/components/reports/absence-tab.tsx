import {
	formatDaysLabel,
	formatHoursLabel,
} from "@farmer/core/lib/report-format";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";

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
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { absenceReportQuery } from "#/queries/reports.ts";

const ABSENCE_UNITS = [
	{ id: "hours", label: "Hours" },
	{ id: "days", label: "Days" },
] as const;

export function AbsenceTab({ year, month }: { year: number; month: number }) {
	const orgSlug = useOrgSlug();
	const { data } = useSuspenseQuery(
		absenceReportQuery(orgSlug, { year, month }),
	);
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
