import type { ReportPdfData } from "../lib/report-pdf";
import type { UtilizationRangeInput } from "../schema/reports";
import { organizationService } from "./organization.service";
import { reportsService } from "./reports.service";
import type { Ctx } from "./types";

export const reportPdfService = {
	// Utilization is period-bound (the given range); budgets & margin are
	// all-time by definition (see reportsService.budgetsAndMargin).
	exportOrgReport: async (
		ctx: Ctx,
		range: UtilizationRangeInput,
	): Promise<{ pdf: Buffer; filename: string }> => {
		// Deliberately a dynamic import: lib/report-pdf pulls in the Typst NAPI
		// binding, which shouldn't load just because something imported the
		// services barrel.
		const {
			renderReportPdf,
			formatDateKeyLabel,
			formatDateKeyMonthDayLabel,
			formatHoursLabel,
			formatMoneyLabel,
			formatWholeHoursValue,
		} = await import("../lib/report-pdf");

		const [org, utilization, budgets] = await Promise.all([
			organizationService.getSettings(ctx),
			reportsService.utilization(ctx, range),
			reportsService.budgetsAndMargin(ctx),
		]);

		const expectedSeconds = utilization.reduce(
			(sum, row) => sum + row.expectedSeconds,
			0,
		);
		const loggedSeconds = utilization.reduce(
			(sum, row) => sum + row.loggedSeconds,
			0,
		);

		// Running header shows a compact period — drop the from-side year when
		// both ends share it ("Jun 1 – Jun 30, 2026").
		const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);

		const data: ReportPdfData = {
			orgName: org.name,
			periodLabel: `${formatDateKeyLabel(range.from)} – ${formatDateKeyLabel(range.to)}`,
			periodShortLabel: `${sameYear ? formatDateKeyMonthDayLabel(range.from) : formatDateKeyLabel(range.from)} – ${formatDateKeyLabel(range.to)}`,
			generatedLabel: new Intl.DateTimeFormat("en-US", {
				dateStyle: "medium",
				timeStyle: "short",
				timeZone: org.timezone,
			}).format(new Date()),
			memberCountLabel: `${utilization.length} member${utilization.length === 1 ? "" : "s"}`,
			summary: {
				logged: { value: formatWholeHoursValue(loggedSeconds), unit: "h" },
				expected: {
					value: formatWholeHoursValue(expectedSeconds),
					unit: "h",
				},
				utilization:
					expectedSeconds > 0
						? {
								value: String(
									Math.round((loggedSeconds / expectedSeconds) * 100),
								),
								unit: "%",
							}
						: { value: "—", unit: null },
				activeProjects: { value: String(budgets.length), unit: null },
			},
			utilization: utilization.map((row) => ({
				name: row.name,
				expected: formatHoursLabel(row.expectedSeconds),
				logged: formatHoursLabel(row.loggedSeconds),
				loggedIsZero: row.loggedSeconds === 0,
				pct: row.utilizationPct,
			})),
			budgets: budgets.map((row) => ({
				name: row.name,
				hours: formatHoursLabel(row.actualSeconds),
				hoursBudget:
					row.budgetSeconds !== null
						? `of ${formatHoursLabel(row.budgetSeconds)}${row.budgetSecondsPct !== null ? ` · ${row.budgetSecondsPct}%` : ""}`
						: null,
				hoursBudgetOver:
					row.budgetSecondsPct !== null && row.budgetSecondsPct > 100,
				revenue: formatMoneyLabel(row.revenue, row.currency),
				revenueIsZero: row.revenue === 0,
				revenueBudget:
					row.budgetAmount !== null
						? `of ${formatMoneyLabel(row.budgetAmount, row.currency)}${row.budgetAmountPct !== null ? ` · ${row.budgetAmountPct}%` : ""}`
						: null,
				cost: formatMoneyLabel(row.cost, row.currency),
				margin: formatMoneyLabel(row.margin, row.currency),
				marginNegative: row.margin < 0,
				marginPct: row.marginPct !== null ? `${row.marginPct}%` : null,
			})),
		};

		return {
			pdf: renderReportPdf(data),
			filename: `${org.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-report-${range.from}-${range.to}.pdf`,
		};
	},
};
