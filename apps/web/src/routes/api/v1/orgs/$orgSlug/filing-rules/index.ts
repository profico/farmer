import { type ApiFilingRule, toApiFilingRule } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/filing-rules` — the caller's own filing rules,
 * from Preferences in the web app. A rule files a synced meeting with the same
 * title to a project. A rule is made when the person files a meeting with
 * `remember`, never on its own.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/filing-rules/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiFilingRule[]> => {
					const { filingRulesService } = await import("@farmer/core/services");
					const rows = await filingRulesService.list(ctx);
					return rows.map(toApiFilingRule);
				},
			}),
		},
	},
});
