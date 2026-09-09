import { createServerFn } from "@tanstack/react-start";

import { orgAdminMiddleware } from "./auth";

// The compliance view answers "who hasn't logged their time" across the whole
// org, so it is Admin-only by definition — there is no project-scoped version
// of a question about people who logged nothing anywhere.
//
// One wrapper, not three: `complianceService.noEntries` and `.behindPace` are
// both already rolled into `dashboard`, and the two server functions that
// exposed them separately were never called from anywhere. Reach for the
// service directly if a screen ever needs one half on its own.

export const getComplianceDashboard = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { complianceService } = await import("@farmer/core/services");
		return complianceService.dashboard(context.ctx);
	});
