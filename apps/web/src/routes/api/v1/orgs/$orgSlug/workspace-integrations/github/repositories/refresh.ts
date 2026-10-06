import {
	type ApiAvailableRepositories,
	toApiAvailableRepositories,
} from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/workspace-integrations/github/repositories/refresh`
 * — the same list, read again from GitHub past the server's copy: for a
 * repository made a minute ago. Admin only. A POST, because it asks for work.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/workspace-integrations/github/repositories/refresh",
)({
	server: {
		handlers: {
			POST: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiAvailableRepositories> => {
					const { githubService } = await import("@farmer/core/services");
					return toApiAvailableRepositories(
						await githubService.listAvailableRepos(ctx, { refresh: true }),
					);
				},
			}),
		},
	},
});
