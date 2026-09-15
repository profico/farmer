import {
	deleteFilingRuleInput,
	updateFilingRuleInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgMiddleware } from "./auth";

// POST, not GET, for the same reason as getIntegrationSettings: these are
// private, cookie-scoped per-user rows and a GET is cacheable.
export const listFilingRules = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { filingRulesService } = await import("@farmer/core/services");
		return filingRulesService.list(context.ctx);
	});

export const updateFilingRule = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(updateFilingRuleInput)
	.handler(async ({ data, context }) => {
		const { filingRulesService } = await import("@farmer/core/services");
		return filingRulesService.update(context.ctx, data);
	});

export const deleteFilingRule = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator(deleteFilingRuleInput)
	.handler(async ({ data, context }) => {
		const { filingRulesService } = await import("@farmer/core/services");
		return filingRulesService.remove(context.ctx, data);
	});
