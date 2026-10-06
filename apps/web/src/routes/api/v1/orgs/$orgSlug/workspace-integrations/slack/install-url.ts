import type { ApiInstallUrl } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/workspace-integrations/slack/install-url` — Slack's "Add to
 * Slack" page, for the system browser. Admin only.
 *
 * The install finishes on the web app: Slack sends the browser to
 * `api/slack/callback`, which needs a signed-in session there.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/workspace-integrations/slack/install-url",
)({
	server: {
		handlers: {
			GET: apiRoute({
				signInOnly: true,
				input: NO_INPUT,
				run: async (ctx): Promise<ApiInstallUrl> => {
					const { slackService } = await import("@farmer/core/services");
					return slackService.installUrl(ctx);
				},
			}),
		},
	},
});
