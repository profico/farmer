import {
	createRecurringBlockRuleInput,
	deleteRecurringBlockRuleInput,
	updateRecurringBlockRuleInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgMiddleware } from "./auth";

export const listRecurringBlockRules = createServerFn({
	method: "GET",
})
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { recurringBlockRulesService } =
			await import("@farmer/core/services");

		return recurringBlockRulesService.list(context.ctx);
	});

export const createRecurringBlockRule = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(createRecurringBlockRuleInput)
	.handler(async ({ data, context }) => {
		const { recurringBlockRulesService } =
			await import("@farmer/core/services");

		return recurringBlockRulesService.create(context.ctx, data);
	});

// No validator: the only input is who is asking. The Break task is resolved
// server-side by system key, so the client never names a task id it has no way
// of knowing.
export const enableDefaultBreakBlock = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { recurringBlockRulesService } =
			await import("@farmer/core/services");

		return recurringBlockRulesService.enableBreak(context.ctx);
	});

export const updateRecurringBlockRule = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(updateRecurringBlockRuleInput)
	.handler(async ({ data, context }) => {
		const { recurringBlockRulesService } =
			await import("@farmer/core/services");

		return recurringBlockRulesService.update(context.ctx, data);
	});

export const deleteRecurringBlockRule = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(deleteRecurringBlockRuleInput)
	.handler(async ({ data: ruleId, context }) => {
		const { recurringBlockRulesService } =
			await import("@farmer/core/services");

		return recurringBlockRulesService.remove(context.ctx, ruleId);
	});
