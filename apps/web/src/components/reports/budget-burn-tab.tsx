import { formatHoursLabel } from "@farmer/core/lib/report-format";
import { useSuspenseQuery } from "@tanstack/react-query";

import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { budgetBurnReportQuery } from "#/queries/reports.ts";

import { ReportTable } from "./shared.tsx";

export function BudgetBurnTab() {
	const orgSlug = useOrgSlug();
	const { data: rows } = useSuspenseQuery(budgetBurnReportQuery(orgSlug));
	return (
		<>
			<ReportTable
				headers={["Project", "Client", "Logged", "Budget", "Remaining", "Burn"]}
				rows={rows.map((r) => [
					r.name,
					r.clientName,
					formatHoursLabel(r.consumedSeconds),
					r.budgetSeconds == null ? "—" : formatHoursLabel(r.budgetSeconds),
					r.remainingSeconds == null
						? "—"
						: formatHoursLabel(r.remainingSeconds),
					r.burnPct == null ? "—" : `${r.burnPct}%`,
				])}
				empty="No active fixed-scope projects — those are the only ones with an hour budget."
			/>
			<p className="mt-4 max-w-[68ch] text-sm text-muted-foreground">
				Hours only. A project's PMs and the admins get a message the first time
				it passes 80% and again at 100%; raising the budget re-arms both.
			</p>
		</>
	);
}
