import {
	absenceReportInput,
	overtimeReportInput,
	timeReportDetailInput,
	timeReportSummaryInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgMiddleware } from "./auth";

// Every report is open to every member at the middleware and scoped in the
// service (§4 matrix): an Admin sees everything, a PM their projects and the
// people on them, a Team Lead their people and their projects, a Member
// themselves. Hence `orgMiddleware` throughout — the narrowing is the
// service's, never the wrapper's.

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

// Overtime is project-scoped, not org-wide: Admin sees everyone, a PM or Team
// Lead sees the overtime logged on their own projects (PRD 6.5). The service
// resolves that scope itself, so the middleware only has to establish the org.
export const getOvertimeReport = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(overtimeReportInput)
	.handler(async ({ data, context }) => {
		const { reportsService } = await import("@farmer/core/services");

		return reportsService.overtime(context.ctx, data);
	});

// People-shaped and scoped by people in the service, like Tracking: a Member
// sees their own absence, a Team Lead their people's, an Admin everyone's.
export const getAbsenceReport = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(absenceReportInput)
	.handler(async ({ data, context }) => {
		const { reportsService } = await import("@farmer/core/services");

		return reportsService.absence(context.ctx, data);
	});
