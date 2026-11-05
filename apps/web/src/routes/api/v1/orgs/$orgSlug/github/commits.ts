import {
	type ApiCommitSuggestion,
	toApiCommitSuggestion,
} from "@farmer/core/api";
import { suggestCommitsInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/github/commits?projectId&date` — the caller's
 * commits on one day, in the repositories of a project they are assigned
 * to. The entry form offers them to attach. 422 when the caller has not
 * connected GitHub.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/github/commits")({
	server: {
		handlers: {
			GET: apiRoute({
				input: suggestCommitsInput,
				run: async (ctx, input): Promise<ApiCommitSuggestion[]> => {
					const { githubService } = await import("@farmer/core/services");
					const rows = await githubService.suggestCommits(ctx, input);
					return rows.map(toApiCommitSuggestion);
				},
			}),
		},
	},
});
