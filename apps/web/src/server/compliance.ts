import { createServerFn } from "@tanstack/react-start";
import { orgAdminMiddleware } from "./auth";

// Both compliance views answer "who hasn't logged their time" across the whole
// org, so they're Admin-only by definition — there is no project-scoped
// version of a question about people who logged nothing anywhere.

export const getComplianceDashboard = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { complianceService } = await import("@farmer/core/services");
		return complianceService.dashboard(context.ctx);
	});

export const getComplianceNoEntries = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { complianceService } = await import("@farmer/core/services");
		return complianceService.noEntries(context.ctx);
	});

export const getComplianceBehindPace = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { complianceService } = await import("@farmer/core/services");
		return complianceService.behindPace(context.ctx);
	});
