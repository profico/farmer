import { formatReportHours } from "@farmer/core/lib/report-format";
import type { TimeReportDetailInput } from "@farmer/core/schema";
import { useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";

import { DropdownMenuItem } from "#/components/ui/dropdown-menu.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { downloadCsv } from "#/lib/csv.ts";
import {
	DETAILED_CSV_HEADERS,
	type DetailedBy,
	detailedCsvRows,
	detailedPdfGroups,
	detailedTruncationNote,
	sumSeconds,
} from "#/lib/detailed-export.ts";
import { downloadPdf } from "#/lib/pdf.ts";
import { timeReportDetailQuery } from "#/queries/reports.ts";

const BY: { by: DetailedBy; label: string }[] = [
	{ by: "person", label: "person" },
	{ by: "project", label: "project" },
];

/** The detailed export's menu items: one row per entry, grouped by person or
 *  by project. The entries are read on the click, through the same query the
 *  drill-down uses, so the period, the filters and a member's own-entries
 *  scope are the report's. Nothing is fetched until somebody picks one. */
export function DetailedExportItems({
	input,
	filename,
	title,
	facts,
}: {
	input: TimeReportDetailInput;
	/** Without an extension. */
	filename: string;
	title: string;
	facts: [string, string][];
}) {
	const orgSlug = useOrgSlug();
	const org = useRouteContext({
		from: "/$orgSlug",
		select: (context) => context.organization.name,
	});
	const queryClient = useQueryClient();

	const run = async (by: DetailedBy, format: "csv" | "pdf") => {
		try {
			const detail = await queryClient.fetchQuery(
				timeReportDetailQuery(orgSlug, input),
			);
			// A Summary row can hold only time off, which the detail leaves out.
			if (detail.rows.length === 0) {
				toast.info("No project entries in this period");
				return;
			}
			const name = `${filename}_by-${by}`;
			if (format === "csv") {
				downloadCsv(
					`${name}.csv`,
					DETAILED_CSV_HEADERS,
					detailedCsvRows(
						detail.rows,
						by,
						detail.truncated ? { totalRows: detail.totalRows } : undefined,
					),
				);
			} else {
				await downloadPdf(`${name}.pdf`, {
					org,
					title,
					from: input.from,
					to: input.to,
					// The sum of the exported rows, so it matches the subtotals.
					total: formatReportHours(sumSeconds(detail.rows)),
					note: detail.truncated
						? detailedTruncationNote(detail.rows.length, detail.totalRows)
						: undefined,
					facts: [
						...facts,
						["Grouped by", by === "person" ? "Person" : "Project"],
						["Entries", "Project time only"],
					],
					...detailedPdfGroups(detail.rows, by),
				});
			}
			if (detail.truncated) {
				toast.warning(
					`Only the first ${detail.rows.length} of ${detail.totalRows} entries are in the file. Narrow the period.`,
				);
			}
		} catch (error) {
			console.error(error);
			toast.error("Could not build the detailed export");
		}
	};

	return BY.flatMap(({ by, label }) => [
		<DropdownMenuItem key={`${by}-csv`} onClick={() => run(by, "csv")}>
			Detailed CSV by {label}
		</DropdownMenuItem>,
		<DropdownMenuItem key={`${by}-pdf`} onClick={() => run(by, "pdf")}>
			Detailed PDF by {label}
		</DropdownMenuItem>,
	]);
}
