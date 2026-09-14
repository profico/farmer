import { createServerFn } from "@tanstack/react-start";

import { orgMiddleware } from "./auth";

// The compliance view answers "who hasn't logged their time". It is scoped by
// the service to the people the caller may see (§4 matrix): everyone for an
// Admin, the people on their list and their projects for a Team Lead, the
// people on their projects for a PM, and themselves for a Member — hence
// `orgMiddleware`, not the admin one.
//
// One wrapper, not three: `complianceService.noEntries` and `.behindPace` are
// both already rolled into `dashboard`, and the two server functions that
// exposed them separately were never called from anywhere. Reach for the
// service directly if a screen ever needs one half on its own.

export const getComplianceDashboard = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { complianceService } = await import("@farmer/core/services");
		return complianceService.dashboard(context.ctx);
	});
