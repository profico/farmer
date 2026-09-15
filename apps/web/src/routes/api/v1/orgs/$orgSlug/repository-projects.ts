import { toApiProject } from "@farmer/core/api";
import { repositoryProjectsInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/repository-projects?repository=owner/name` — the
 * projects the caller may log time on that have a Linked repository of that
 * name; `farmer init` uses it to suggest a project from the git remote.
 *
 * A separate route rather than a field on `ApiProject`, so every `log` does
 * not carry repository names, and so an older server answers 404 (no
 * suggestion) instead of ignoring an unknown query parameter and returning
 * every project.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/repository-projects",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: repositoryProjectsInput,
				run: async (ctx, input) => {
					const { githubService } = await import("@farmer/core/services");
					const rows = await githubService.projectsForRepository(
						ctx,
						input.repository,
					);
					return rows.map(toApiProject);
				},
			}),
		},
	},
});
