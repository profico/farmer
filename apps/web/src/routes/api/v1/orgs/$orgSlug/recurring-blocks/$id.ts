import type { ApiRecurringBlock } from "@farmer/core/api";
import {
	deleteRecurringBlockRuleInput,
	updateRecurringBlockRuleInput,
} from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { bodyWithPathId } from "#/server/api-query.ts";
import { ownRecurringBlock } from "#/server/api-recurring-blocks.ts";
import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

const byId = z.object({ ruleId: deleteRecurringBlockRuleInput });

/**
 * `PATCH` and `DELETE /api/v1/orgs/$orgSlug/recurring-blocks/$id` — change or
 * remove one of the caller's recurring blocks.
 *
 * The PATCH is a partial patch. `projectId: null` takes the project off, and
 * `active: false` pauses the rule. A change to the shape or the duration does
 * not rewrite the blocks that are already on the timesheet.
 *
 * The DELETE removes the rule and keeps the blocks it already wrote. The rule
 * is read first, so another person's rule, or one that is gone, is a 404 and
 * not a delete that did nothing.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/recurring-blocks/$id",
)({
	server: {
		handlers: {
			PATCH: apiRoute({
				input: updateRecurringBlockRuleInput,
				raw: bodyWithPathId("ruleId"),
				run: async (ctx, input): Promise<ApiRecurringBlock> => {
					const { recurringBlockRulesService } =
						await import("@farmer/core/services");
					await recurringBlockRulesService.update(ctx, input);
					return ownRecurringBlock(ctx, input.ruleId);
				},
			}),
			DELETE: apiRoute({
				input: byId,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({ ruleId: params.id }),
				run: async (ctx, { ruleId }) => {
					const { recurringBlockRulesService } =
						await import("@farmer/core/services");
					await ownRecurringBlock(ctx, ruleId);
					await recurringBlockRulesService.remove(ctx, ruleId);
					return { id: ruleId };
				},
			}),
		},
	},
});
