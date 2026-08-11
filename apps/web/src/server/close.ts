import {
	closePeriodInput,
	closeSheetInput,
	closeTransitionInput,
	saveCloseRowInput,
	setCloseRowFinalInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { orgMiddleware } from "./auth";

// Every close endpoint is PM-or-Admin, and which of the two you are decides
// what you may edit (Adjusted vs Final). That distinction is resolved inside
// closeService against the caller's per-project role, so these all take plain
// `orgMiddleware` — an org-wide admin middleware would wrongly lock PMs out.

export const listCloseOverview = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(closePeriodInput)
	.handler(async ({ data, context }) => {
		const { closeService } = await import("@farmer/core/services");
		return closeService.overview(context.ctx, data.year, data.month);
	});

export const getCloseSheet = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(closeSheetInput)
	.handler(async ({ data, context }) => {
		const { closeService } = await import("@farmer/core/services");
		return closeService.getSheet(context.ctx, data);
	});

export const saveCloseRow = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(saveCloseRowInput)
	.handler(async ({ data, context }) => {
		const { closeService } = await import("@farmer/core/services");
		return closeService.saveRow(context.ctx, data);
	});

export const setCloseRowFinal = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(setCloseRowFinalInput)
	.handler(async ({ data, context }) => {
		const { closeService } = await import("@farmer/core/services");
		return closeService.setFinal(context.ctx, data);
	});

export const submitClose = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(closeTransitionInput)
	.handler(async ({ data, context }) => {
		const { closeService } = await import("@farmer/core/services");
		return closeService.submit(context.ctx, data);
	});

export const reopenClose = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(closeTransitionInput)
	.handler(async ({ data, context }) => {
		const { closeService } = await import("@farmer/core/services");
		return closeService.reopen(context.ctx, data);
	});

export const finalizeClose = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(closeTransitionInput)
	.handler(async ({ data, context }) => {
		const { closeService } = await import("@farmer/core/services");
		return closeService.finalize(context.ctx, data);
	});
