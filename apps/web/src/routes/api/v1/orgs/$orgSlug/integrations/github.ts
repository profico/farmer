import type { ApiIntegrations } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { unlinkIntegration } from "#/server/api-integrations.ts";
import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `DELETE /api/v1/orgs/$orgSlug/integrations/github` — disconnect the
 * caller's GitHub account, as Disconnect on Settings → Integrations does. The
 * commits and pull requests already on entries stay. Answers the new state.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/integrations/github",
)({
	server: {
		handlers: {
			DELETE: apiRoute({
				input: NO_INPUT,
				run: (ctx): Promise<ApiIntegrations> =>
					unlinkIntegration(ctx, "github"),
			}),
		},
	},
});
