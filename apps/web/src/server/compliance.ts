import { monthReportInput } from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgMiddleware } from "./auth";

// The Tracking report: everyone's work + time-off against the month's hour
// fund, prorated by the working days elapsed (the one rule the reminders use
// too). Scoped by the service to the people the caller may see (§4 matrix):
// everyone for an Admin, their people and their projects for a Team Lead, the
// people on their projects for a PM, and themselves for a Member — hence
// `orgMiddleware`, not the admin one.
export const getTrackingReport = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(monthReportInput)
	.handler(async ({ data, context }) => {
		const { complianceService } = await import("@farmer/core/services");

		return complianceService.tracking(context.ctx, data);
	});

// The caller's own week and month against the rule, for the home page and the
// timesheet. Their own figures only, so there is nothing to scope.
export const getMyTargets = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { complianceService } = await import("@farmer/core/services");

		return complianceService.myTargets(context.ctx);
	});
