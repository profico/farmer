import {
	type ApiAvailableRepositories,
	toApiAvailableRepositories,
} from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/workspace-integrations/github/repositories` —
 * each repository that a connected installation can read, private ones too,
 * with the project that holds it. Admin only. The server keeps the list for
 * a few minutes. `POST …/repositories/refresh` reads it again from GitHub.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/workspace-integrations/github/repositories/",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiAvailableRepositories> => {
					const { githubService } = await import("@farmer/core/services");
					return toApiAvailableRepositories(
						await githubService.listAvailableRepos(ctx),
					);
				},
			}),
		},
	},
});
