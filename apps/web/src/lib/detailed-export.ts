import {
	formatDecimalHours,
	formatReportHours,
} from "@farmer/core/lib/report-format";
import type { TimeReportDetailRow } from "@farmer/core/services";

import { formatPdfDate } from "./pdf.ts";

// The detailed export: one row per time entry, in groups, the way Harvest's
// "Detailed time report" is. Pure, so the order and the sums are tested
// without a browser. The rows come from the report's own detail query, so the
// period, the filters and a member's own-entries scope are already applied.

export type DetailedBy = "person" | "project";

const collator = new Intl.Collator("hr");

/** Project name, with its code when it has one. */
const projectLabel = (r: TimeReportDetailRow) =>
	r.projectCode ? `[${r.projectCode}] ${r.projectName}` : r.projectName;

const groupLabel = (r: TimeReportDetailRow, by: DetailedBy) =>
	by === "person" ? r.userName : projectLabel(r);

/** Grouped by id, not by name: two people can share a name. Groups in name
 *  order; entries inside a group by date. The order inside one day is not
 *  fixed: the rows have no start time. */
export function groupDetailedRows(
	rows: readonly TimeReportDetailRow[],
	by: DetailedBy,
): { label: string; seconds: number; rows: TimeReportDetailRow[] }[] {
	const groups = new Map<
		string,
		{ label: string; seconds: number; rows: TimeReportDetailRow[] }
	>();
	for (const row of rows) {
		const key = by === "person" ? row.userId : row.projectId;
		const group = groups.get(key) ?? {
			label: groupLabel(row, by),
			seconds: 0,
			rows: [],
		};
		group.rows.push(row);
		group.seconds += row.durationSeconds;
		groups.set(key, group);
	}
	return [...groups.values()]
		.sort((a, b) => collator.compare(a.label, b.label))
		.map((group) => ({
			...group,
			// Same-day entries keep the order the query gave; it is not fixed.
			rows: [...group.rows].sort((a, b) => a.date.localeCompare(b.date)),
		}));
}

export const DETAILED_CSV_HEADERS = [
	"Date",
	"Client",
	"Project",
	"Code",
	"Task",
	"Notes",
	"Hours",
	"Overtime",
	"Person",
];

/** The note for a result that the query cut short. */
export const detailedTruncationNote = (shown: number, total: number) =>
	`Cut at ${shown} of ${total} entries. Pick a shorter period for the rest.`;

/** The sum of the rows in the file. It differs from the report total when the
 *  query cut the rows. */
export const sumSeconds = (rows: readonly TimeReportDetailRow[]) =>
	rows.reduce((sum, r) => sum + r.durationSeconds, 0);

/** One CSV row per entry, sorted by the group and then by date. A cut result
 *  ends with one marker row. */
export function detailedCsvRows(
	rows: readonly TimeReportDetailRow[],
	by: DetailedBy,
	truncation?: { totalRows: number },
): string[][] {
	const marker = truncation
		? [
				[
					detailedTruncationNote(rows.length, truncation.totalRows),
					...DETAILED_CSV_HEADERS.slice(1).map(() => ""),
				],
			]
		: [];
	const body = groupDetailedRows(rows, by).flatMap((group) =>
		group.rows.map((r) => [
			r.date,
			r.clientName,
			r.projectName,
			r.projectCode ?? "",
			r.taskName,
			r.description,
			formatDecimalHours(r.durationSeconds),
			r.overtime ? "yes" : "",
			r.userName,
		]),
	);
	return [...body, ...marker];
}

/** The PDF's groups: a heading with the subtotal over each, the group's own
 *  column left out. */
export function detailedPdfGroups(
	rows: readonly TimeReportDetailRow[],
	by: DetailedBy,
) {
	const columns = [
		"Date",
		"Client",
		...(by === "person" ? ["Project"] : ["Person"]),
		"Task",
	];
	return {
		columns: [
			...columns.map((label) => ({ label })),
			{ label: "Hours", align: "right" as const },
		],
		groups: groupDetailedRows(rows, by).map((group) => ({
			heading: group.label,
			hours: formatReportHours(group.seconds),
			rows: group.rows.map((r) => ({
				cells: [
					formatPdfDate(r.date),
					r.clientName,
					by === "person" ? projectLabel(r) : r.userName,
					r.taskName,
					formatReportHours(r.durationSeconds),
				],
				note:
					[r.description, r.overtime ? "Overtime" : ""]
						.filter(Boolean)
						.join(" · ") || undefined,
			})),
		})),
	};
}
