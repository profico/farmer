import {
	setMemberAllowanceInput,
	updateTimeOffPolicyInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { orgAdminMiddleware, orgMiddleware } from "./auth";

export const getTimeOffPolicy = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { timeOffPolicyService } = await import("@farmer/core/services");
		return timeOffPolicyService.getPolicy(context.ctx);
	});

export const updateTimeOffPolicy = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(updateTimeOffPolicyInput)
	.handler(async ({ data, context }) => {
		const { timeOffPolicyService } = await import("@farmer/core/services");
		return timeOffPolicyService.updatePolicy(context.ctx, data);
	});

export const listMemberAllowances = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { timeOffPolicyService } = await import("@farmer/core/services");
		return timeOffPolicyService.listMemberAllowances(context.ctx);
	});

export const setMemberAllowance = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(setMemberAllowanceInput)
	.handler(async ({ data, context }) => {
		const { timeOffPolicyService } = await import("@farmer/core/services");
		await timeOffPolicyService.setMemberAllowance(context.ctx, data);
	});
