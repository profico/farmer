import type { ApiRecurringBlock } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { ownRecurringBlock } from "#/server/api-recurring-blocks.ts";
import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/recurring-blocks/break` — the switch for the
 * daily break on Settings → Recurring blocks: 30 minutes of Break, Monday to
 * Friday. The server finds the Break task, so the request names nothing.
 *
 * Idempotent. A break rule that exists is switched on again, never copied.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/recurring-blocks/break",
)({
	server: {
		handlers: {
			POST: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiRecurringBlock> => {
					const { recurringBlockRulesService } =
						await import("@farmer/core/services");
					const rule = await recurringBlockRulesService.enableBreak(ctx);
					return ownRecurringBlock(ctx, rule.id);
				},
			}),
		},
	},
});
