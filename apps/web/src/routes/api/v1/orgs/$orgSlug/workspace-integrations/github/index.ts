import {
	type ApiGithubWorkspace,
	toApiGithubInstallation,
} from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/workspace-integrations/github` — the GitHub App
 * installations connected to this workspace. Admin only.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/workspace-integrations/github/",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiGithubWorkspace> => {
					const { githubService } = await import("@farmer/core/services");
					const { setting } =
						await import("@farmer/core/lib/instance-settings");
					const rows = await githubService.listInstallations(ctx);
					return {
						appConfigured: Boolean(setting("GITHUB_APP_SLUG")),
						installations: rows.map(toApiGithubInstallation),
					};
				},
			}),
		},
	},
});
