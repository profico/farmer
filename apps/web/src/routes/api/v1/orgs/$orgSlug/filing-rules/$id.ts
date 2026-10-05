import { type ApiFilingRule, toApiFilingRule } from "@farmer/core/api";
import {
	deleteFilingRuleInput,
	updateFilingRuleInput,
} from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { bodyWithPath } from "#/server/api-query.ts";
import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

/**
 * `PATCH` and `DELETE /api/v1/orgs/$orgSlug/filing-rules/$id` — change where
 * one of the caller's rules files its meetings, or remove the rule. Both
 * services filter on the caller, so another person's rule is a 404.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/filing-rules/$id")({
	server: {
		handlers: {
			PATCH: apiRoute({
				input: updateFilingRuleInput,
				raw: ({ params, body }: ApiRequest<OrgRowParams>) =>
					bodyWithPath(body, { id: params.id }),
				run: async (ctx, input): Promise<ApiFilingRule> => {
					const { filingRulesService } = await import("@farmer/core/services");
					await filingRulesService.update(ctx, input);
					const rule = (await filingRulesService.list(ctx)).find(
						(row) => row.id === input.id,
					);
					if (!rule) throw new Error("Filing rule not found");
					return toApiFilingRule(rule);
				},
			}),
			DELETE: apiRoute({
				input: deleteFilingRuleInput,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({ id: params.id }),
				run: async (ctx, input) => {
					const { filingRulesService } = await import("@farmer/core/services");
					const removed = await filingRulesService.remove(ctx, input);
					return { id: removed.id };
				},
			}),
		},
	},
});
