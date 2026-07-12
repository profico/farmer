import { utilizationRangeInput } from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { orgAdminMiddleware } from "./auth";

export const getUtilizationReport = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(utilizationRangeInput)
	.handler(async ({ data, context }) => {
		const { reportsService } = await import("@farmer/core/services");
		return reportsService.utilization(context.ctx, data);
	});

export const getBudgetsAndMarginReport = createServerFn({
	method: "GET",
})
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { reportsService } = await import("@farmer/core/services");
		return reportsService.budgetsAndMargin(context.ctx);
	});
