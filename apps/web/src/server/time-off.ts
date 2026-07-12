import {
	cancelTimeOffRequestInput,
	createTimeOffRequestInput,
	decideTimeOffRequestInput,
	getTimeOffBalanceInput,
	listAllTimeOffRequestsFilterInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { orgMiddleware } from "./auth";

export const listMyTimeOff = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { timeOffService } = await import("@farmer/core/services");
		return timeOffService.listMine(context.ctx);
	});

export const createTimeOffRequest = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(createTimeOffRequestInput)
	.handler(async ({ data, context }) => {
		const { timeOffService } = await import("@farmer/core/services");
		return timeOffService.create(context.ctx, data);
	});

export const cancelTimeOffRequest = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(cancelTimeOffRequestInput)
	.handler(async ({ data: requestId, context }) => {
		const { timeOffService } = await import("@farmer/core/services");
		await timeOffService.cancel(context.ctx, requestId);
	});

// The caller's vacation balance for a year (self only). Defaults to this year.
export const getTimeOffBalance = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(getTimeOffBalanceInput)
	.handler(async ({ data, context }) => {
		const { timeOffService } = await import("@farmer/core/services");
		const year = data?.year ?? new Date().getUTCFullYear();
		return timeOffService.getBalance(context.ctx, { year });
	});

// Reviewers the caller may address a request to (approvers on their projects
// plus owners/admins).
export const listEligibleReviewers = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { timeOffService } = await import("@farmer/core/services");
		return timeOffService.listEligibleReviewers(context.ctx);
	});

// Whether the caller can act on any time-off requests (gates the approvals UI).
export const getIsTimeOffApprover = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { timeOffService } = await import("@farmer/core/services");
		return timeOffService.isApprover(context.ctx);
	});

// Requests the caller may review, optionally filtered by status. Permission
// scoping (owner/admin vs project approver) is enforced in the service.
export const listAllTimeOffRequests = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(listAllTimeOffRequestsFilterInput)
	.handler(async ({ data, context }) => {
		const { timeOffService } = await import("@farmer/core/services");
		return timeOffService.listAllForOrg(context.ctx, data);
	});

export const countPendingTimeOff = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { timeOffService } = await import("@farmer/core/services");
		return timeOffService.countPending(context.ctx);
	});

export const decideTimeOffRequest = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(decideTimeOffRequestInput)
	.handler(async ({ data, context }) => {
		const { timeOffService } = await import("@farmer/core/services");
		return timeOffService.decide(context.ctx, data);
	});
