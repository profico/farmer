import type { ApiHourFundSuggestion } from "@farmer/core/api";
import { monthPeriodInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { typedQuery } from "#/server/api-query.ts";
import { apiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/hour-fund/suggestion?year&month` — what the
 * holiday calendar gives for one month: the weekdays that are not public
 * holidays, at 8 hours each. Nothing is stored. Admins only.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/hour-fund/suggestion",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: monthPeriodInput,
				raw: typedQuery({ numbers: ["year", "month"] }),
				run: async (ctx, { year, month }): Promise<ApiHourFundSuggestion> => {
					const { hourFundService } = await import("@farmer/core/services");
					const suggestion = await hourFundService.suggestForMonth(
						ctx,
						year,
						month,
					);
					return {
						workingDays: suggestion.workingDays,
						fundSeconds: suggestion.fundSeconds,
					};
				},
			}),
		},
	},
});
