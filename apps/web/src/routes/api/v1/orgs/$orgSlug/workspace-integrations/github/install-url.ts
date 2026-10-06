import type { ApiInstallUrl } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/workspace-integrations/github/install-url` — the GitHub
 * page that installs the App, for the system browser. Admin only.
 *
 * The install finishes on the web app: GitHub sends the browser to
 * `api/github/setup`, which needs a signed-in session there.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/workspace-integrations/github/install-url",
)({
	server: {
		handlers: {
			GET: apiRoute({
				signInOnly: true,
				input: NO_INPUT,
				run: async (ctx): Promise<ApiInstallUrl> => {
					const { githubService } = await import("@farmer/core/services");
					return githubService.installUrl(ctx);
				},
			}),
		},
	},
});
