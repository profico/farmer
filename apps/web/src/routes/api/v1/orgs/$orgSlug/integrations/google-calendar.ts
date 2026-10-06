import type { ApiIntegrations } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { unlinkIntegration } from "#/server/api-integrations.ts";
import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `DELETE /api/v1/orgs/$orgSlug/integrations/google-calendar` — disconnect
 * the caller's Google Calendar, as Disconnect on Settings → Integrations
 * does. Sign in with Google is a different account row, and stays. Answers
 * the new state.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/integrations/google-calendar",
)({
	server: {
		handlers: {
			DELETE: apiRoute({
				input: NO_INPUT,
				run: (ctx): Promise<ApiIntegrations> =>
					unlinkIntegration(ctx, "google-calendar"),
			}),
		},
	},
});
