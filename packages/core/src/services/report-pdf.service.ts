import type { ReportPdfData } from "../lib/report-pdf";
import type { MonthReportInput } from "../schema/reports";
import { organizationService } from "./organization.service";
import { reportsService } from "./reports.service";
import type { Ctx } from "./types";

export const reportPdfService = {
	/**
	 * The org's month report as a PDF. Month-scoped rather than free-range,
	 * because both figures it leads with — Final hours and Expected hours — only
	 * exist per closed month.
	 *
	 * Hours only, no money. There are no rates in this system, so revenue, cost
	 * and margin can't be derived from anything; a project's monetary budget is
	 * carried through as a plain label and never computed against. Budget burn is
	 * all-time by definition (it measures a fixed scope, not a period).
	 */
	exportOrgReport: async (
		ctx: Ctx,
		input: MonthReportInput,
	): Promise<{ pdf: Buffer; filename: string }> => {
		// Deliberately a dynamic import: lib/report-pdf pulls in the Typst NAPI
		// binding, which shouldn't load just because something imported the
		// services barrel.
		const {
			renderReportPdf,
			formatMonthLabel,
			formatMonthShortLabel,
			formatHoursLabel,
			formatWholeHoursValue,
		} = await import("../lib/report-pdf");

		const [org, utilization, budgets] = await Promise.all([
			organizationService.getSettings(ctx),
			reportsService.utilization(ctx, input),
			reportsService.budgetBurn(ctx),
		]);

		// Contractors without an expected figure contribute Final hours but no
		// denominator, so they're summed into the numerator and skipped in the
		// denominator rather than counted as zero-expected.
		const expectedSeconds = utilization.reduce(
			(sum, row) => sum + (row.expectedSeconds ?? 0),
			0,
		);
		const finalSeconds = utilization.reduce(
			(sum, row) => sum + row.finalSeconds,
			0,
		);

		const typeLabels = {
			billable: "Billable",
			overhead: "Overhead",
			contractor: "Contractor",
		} as const;

		const data: ReportPdfData = {
			orgName: org.name,
			periodLabel: formatMonthLabel(input.year, input.month),
			periodShortLabel: formatMonthShortLabel(input.year, input.month),
			generatedLabel: new Intl.DateTimeFormat("en-US", {
				dateStyle: "medium",
				timeStyle: "short",
				timeZone: org.timezone,
			}).format(new Date()),
			memberCountLabel: `${utilization.length} member${utilization.length === 1 ? "" : "s"}`,
			summary: {
				final: { value: formatWholeHoursValue(finalSeconds), unit: "h" },
				expected: {
					value: formatWholeHoursValue(expectedSeconds),
					unit: "h",
				},
				utilization:
					expectedSeconds > 0
						? {
								value: String(
									Math.round((finalSeconds / expectedSeconds) * 100),
								),
								unit: "%",
							}
						: { value: "—", unit: null },
				activeProjects: { value: String(budgets.length), unit: null },
			},
			utilization: utilization.map((row) => ({
				name: row.name,
				typeLabel: typeLabels[row.memberType],
				expected:
					row.expectedSeconds !== null
						? formatHoursLabel(row.expectedSeconds)
						: "—",
				final: formatHoursLabel(row.finalSeconds),
				finalIsZero: row.finalSeconds === 0,
				pct: row.utilizationPct,
			})),
			budgets: budgets.map((row) => ({
				name: row.name,
				clientName: row.clientName,
				hours: formatHoursLabel(row.consumedSeconds),
				budget:
					row.budgetSeconds !== null
						? formatHoursLabel(row.budgetSeconds)
						: null,
				// Present only for people allowed to see money on that project
				// (budgetBurn nulls it out otherwise). Unit-less on purpose: the
				// system stores an amount, not a currency.
				budgetAmount:
					row.budgetAmount !== null
						? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(row.budgetAmount))} budget`
						: null,
				// Overrun reads as "−12h" in red rather than a bare figure, so a
				// blown budget can't be misread as headroom.
				remaining:
					row.remainingSeconds !== null
						? `${row.remainingSeconds < 0 ? "−" : ""}${formatHoursLabel(Math.abs(row.remainingSeconds))}`
						: null,
				remainingNegative:
					row.remainingSeconds !== null && row.remainingSeconds < 0,
				pct: row.burnPct,
			})),
		};

		return {
			pdf: renderReportPdf(data),
			filename: `${org.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-report-${input.year}-${String(input.month).padStart(2, "0")}.pdf`,
		};
	},
};
