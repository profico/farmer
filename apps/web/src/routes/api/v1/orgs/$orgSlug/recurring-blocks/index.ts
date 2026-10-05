import { type ApiRecurringBlock, toApiRecurringBlock } from "@farmer/core/api";
import { createRecurringBlockRuleInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { ownRecurringBlock } from "#/server/api-recurring-blocks.ts";
import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET` and `POST /api/v1/orgs/$orgSlug/recurring-blocks` — the caller's own
 * recurring blocks, as on Settings → Recurring blocks.
 *
 * The POST makes a rule with the same checks as an entry made by hand: the
 * caller may log on the project, the task may go on it, and the task's note
 * rule holds. `duration` is text such as "30m" or "1h 30m".
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/recurring-blocks/")(
	{
		server: {
			handlers: {
				GET: apiRoute({
					input: NO_INPUT,
					run: async (ctx): Promise<ApiRecurringBlock[]> => {
						const { recurringBlockRulesService } =
							await import("@farmer/core/services");
						const rules = await recurringBlockRulesService.list(ctx);
						return rules.map(toApiRecurringBlock);
					},
				}),
				POST: apiRoute({
					input: createRecurringBlockRuleInput,
					run: async (ctx, input): Promise<ApiRecurringBlock> => {
						const { recurringBlockRulesService } =
							await import("@farmer/core/services");
						const created = await recurringBlockRulesService.create(ctx, input);
						return ownRecurringBlock(ctx, created.id);
					},
				}),
			},
		},
	},
);
