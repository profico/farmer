import {
	type ApiPullRequestSuggestion,
	toApiPullRequestSuggestion,
} from "@farmer/core/api";
import { suggestPullRequestsInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/github/pull-requests?projectId&date` — the pull
 * requests the caller opened, merged, closed or reviewed on one day, in the
 * repositories of a project they are assigned to. 422 when the caller has not
 * connected GitHub.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/github/pull-requests",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: suggestPullRequestsInput,
				run: async (ctx, input): Promise<ApiPullRequestSuggestion[]> => {
					const { githubService } = await import("@farmer/core/services");
					const rows = await githubService.suggestPullRequests(ctx, input);
					return rows.map(toApiPullRequestSuggestion);
				},
			}),
		},
	},
});
