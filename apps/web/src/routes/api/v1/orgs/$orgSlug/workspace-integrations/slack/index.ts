import { type ApiSlackStatus, toApiSlackStatus } from "@farmer/core/api";
import type { Ctx } from "@farmer/core/services";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/** The status, read through the same door every send goes through. The bot
 *  token is never in it. */
const status = async (ctx: Ctx): Promise<ApiSlackStatus> => {
	const { slackService } = await import("@farmer/core/services");
	const { setting } = await import("@farmer/core/lib/instance-settings");
	return toApiSlackStatus(
		await slackService.status(ctx),
		Boolean(setting("SLACK_CLIENT_ID")),
	);
};

/**
 * `GET` and `DELETE /api/v1/orgs/$orgSlug/workspace-integrations/slack` — the Slack
 * workspace connected to this organization, and disconnecting it. Admin only.
 * The DELETE answers the status after the disconnect.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/workspace-integrations/slack/",
)({
	server: {
		handlers: {
			GET: apiRoute({ signInOnly: true, input: NO_INPUT, run: status }),
			DELETE: apiRoute({
				signInOnly: true,
				input: NO_INPUT,
				run: async (ctx): Promise<ApiSlackStatus> => {
					const { slackService } = await import("@farmer/core/services");
					await slackService.disconnect(ctx);
					return status(ctx);
				},
			}),
		},
	},
});
