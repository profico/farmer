import { formatHoursLabel } from "@farmer/core/lib/report-format";
import { useSuspenseQuery } from "@tanstack/react-query";

import { PersonCell } from "#/components/person-avatar.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { complianceDashboardQuery } from "#/queries/compliance.ts";

import { ReportTable } from "./shared.tsx";

// PRD 6.2 — the forgetting-detector. Two lists, always shown together: "hasn't
// logged at all lately" and "logging, but behind pace". They answer different
// questions and someone can be in exactly one of them.
export function ComplianceTab() {
	const orgSlug = useOrgSlug();
	const { data } = useSuspenseQuery(complianceDashboardQuery(orgSlug));
	return (
		// Two independent lists that are always read together — stacked they cost a
		// scroll to compare, side by side on a wide screen they don't.
		<div className="grid gap-10 xl:grid-cols-2 xl:items-start xl:gap-8">
			<section className="min-w-0">
				<h2 className="eyebrow">No recent entries</h2>
				<p className="mt-2 max-w-[68ch] text-sm text-muted-foreground">
					Nothing logged in the last few working days. Overhead people are never
					listed — the system doesn't nag anyone whose hours aren't tracked
					against a fund.
				</p>
				<ReportTable
					columned
					headers={["Person", "Type", "Last entry", "Working days missing"]}
					rows={data.noEntries.map((r) => ({
						key: r.userId,
						cells: [
							<PersonCell key="person" userId={r.userId} name={r.name} />,
							r.memberType,
							r.lastEntryDate ?? "Never",
							String(r.workingDaysMissing),
						],
					}))}
					empty="Everyone is up to date."
				/>
			</section>

			<section className="min-w-0">
				<h2 className="eyebrow">Behind pace this month</h2>
				<p className="mt-2 max-w-[68ch] text-sm text-muted-foreground">
					Month-to-date hours against Expected prorated by the working days that
					have actually elapsed. Contractors appear only when they have an
					explicit expected-hours figure.
				</p>
				<ReportTable
					columned
					headers={["Person", "Logged", "Expected so far", "Pace", "Short by"]}
					rows={data.behindPace.map((r) => ({
						key: r.userId,
						cells: [
							<PersonCell key="person" userId={r.userId} name={r.name} />,
							formatHoursLabel(r.loggedSeconds),
							formatHoursLabel(r.proratedExpectedSeconds),
							`${r.pacePct}%`,
							formatHoursLabel(r.shortfallSeconds),
						],
					}))}
					empty="Nobody is behind pace."
				/>
			</section>
		</div>
	);
}
