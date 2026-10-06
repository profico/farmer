import type { ApiSlackMatch } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/workspace-integrations/slack/match-people` — "Re-match
 * people": finds each active member's Slack account by email. Admin only.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/workspace-integrations/slack/match-people",
)({
	server: {
		handlers: {
			POST: apiRoute({
				signInOnly: true,
				input: NO_INPUT,
				run: async (ctx): Promise<ApiSlackMatch> => {
					const { slackService } = await import("@farmer/core/services");
					return { mapped: await slackService.syncIdentities(ctx) };
				},
			}),
		},
	},
});
