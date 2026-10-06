import type { ApiSlackTest } from "@farmer/core/api";
import { sendTestSlackMessageInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/workspace-integrations/slack/test` — sends one member a
 * test message on Slack, through the path the reminders take. Admin only.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/workspace-integrations/slack/test",
)({
	server: {
		handlers: {
			POST: apiRoute({
				signInOnly: true,
				input: sendTestSlackMessageInput,
				run: async (ctx, { userId }): Promise<ApiSlackTest> => {
					const { slackService } = await import("@farmer/core/services");
					await slackService.sendTest(ctx, userId);
					return { sent: true };
				},
			}),
		},
	},
});
