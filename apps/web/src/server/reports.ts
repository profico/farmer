import {
	absenceReportInput,
	monthReportInput,
	overtimeDetailInput,
	timeReportDetailInput,
	timeReportSummaryInput,
	utilizationTrendInput,
	varianceTrendInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgAdminMiddleware, orgMiddleware } from "./auth";

// Reports split cleanly in two:
//
//   * Project-scoped (Time, Budget burn) — everyone may call them; the service
//     narrows the rows to the caller's Team Lead/PM projects, and a plain
//     Member sees only their own entries. Hence `orgMiddleware`.
//   * Org-wide (Overtime, Absence, Variance, Utilization) — these are
//     statements about the whole company, so they're Admin-only at the
//     middleware AND asserted again in the service.

export const getTimeReportSummary = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(timeReportSummaryInput)
	.handler(async ({ data, context }) => {
		const { reportsService } = await import("@farmer/core/services");
		return reportsService.timeSummary(context.ctx, data);
	});

export const getTimeReportDetail = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(timeReportDetailInput)
	.handler(async ({ data, context }) => {
		const { reportsService } = await import("@farmer/core/services");
		return reportsService.timeDetail(context.ctx, data);
	});

export const getBudgetBurnReport = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { reportsService } = await import("@farmer/core/services");
		return reportsService.budgetBurn(context.ctx);
	});

// Overtime is project-scoped, not org-wide: Admin sees everyone, a PM or Team
// Lead sees the overtime logged on their own projects (PRD 6.5). The service
// resolves that scope itself, so the middleware only has to establish the org.
export const getOvertimeReport = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(monthReportInput)
	.handler(async ({ data, context }) => {
		const { reportsService } = await import("@farmer/core/services");
		return reportsService.overtime(context.ctx, data);
	});

export const getOvertimeDetail = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(overtimeDetailInput)
	.handler(async ({ data, context }) => {
		const { reportsService } = await import("@farmer/core/services");
		return reportsService.overtimeDetail(context.ctx, data);
	});

export const getAbsenceReport = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(absenceReportInput)
	.handler(async ({ data, context }) => {
		const { reportsService } = await import("@farmer/core/services");
		return reportsService.absence(context.ctx, data);
	});

export const getVarianceReport = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(monthReportInput)
	.handler(async ({ data, context }) => {
		const { reportsService } = await import("@farmer/core/services");
		return reportsService.variance(context.ctx, data);
	});

export const getVarianceTrend = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(varianceTrendInput)
	.handler(async ({ data, context }) => {
		const { reportsService } = await import("@farmer/core/services");
		return reportsService.varianceTrend(context.ctx, data);
	});

export const getUtilizationReport = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(monthReportInput)
	.handler(async ({ data, context }) => {
		const { reportsService } = await import("@farmer/core/services");
		return reportsService.utilization(context.ctx, data);
	});

export const getUtilizationTrend = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(utilizationTrendInput)
	.handler(async ({ data, context }) => {
		const { reportsService } = await import("@farmer/core/services");
		return reportsService.utilizationTrend(context.ctx, data);
	});
