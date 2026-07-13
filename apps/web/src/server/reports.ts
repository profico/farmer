import { utilizationRangeInput } from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { orgAdminMiddleware, orgMiddleware } from "./auth";

export const getUtilizationReport = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(utilizationRangeInput)
	.handler(async ({ data, context }) => {
		const { reportsService } = await import("@farmer/core/services");
		return reportsService.utilization(context.ctx, data);
	});

// The member-facing counterpart to getUtilizationReport: any member may see
// their OWN expected-vs-logged hours (no rates/cost/margin are in this shape).
// Guarded by orgMiddleware, and the userId is forced to the caller's — a member
// can never request another member's row.
export const getMyUtilization = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(utilizationRangeInput)
	.handler(async ({ data, context }) => {
		const { reportsService } = await import("@farmer/core/services");
		const rows = await reportsService.utilization(context.ctx, {
			from: data.from,
			to: data.to,
			userId: context.ctx.userId,
		});
		return rows[0] ?? null;
	});

export const getBudgetsAndMarginReport = createServerFn({
	method: "GET",
})
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { reportsService } = await import("@farmer/core/services");
		return reportsService.budgetsAndMargin(context.ctx);
	});
