import {
	type ApiProjectRepository,
	toApiProjectRepository,
} from "@farmer/core/api";
import {
	linkProjectRepoInput,
	listProjectReposInput,
} from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { bodyWithPath } from "#/server/api-query.ts";
import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

const byProject = z.object({ projectId: listProjectReposInput });

/**
 * `/api/v1/orgs/$orgSlug/projects/$id/repositories` — the GitHub repositories
 * linked to a project.
 *
 * The list is for each person who may log time on the project, as the
 * entry form's commit picker reads it. A member whose only way in is a
 * project open to the organization gets an empty list. A link is for an
 * admin, and names a repository from
 * `workspace-integrations/github/repositories`. A repository belongs to one
 * project: a second link is a 422 that names the project that holds it.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/projects/$id/repositories/",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: byProject,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					projectId: params.id,
				}),
				run: async (ctx, { projectId }): Promise<ApiProjectRepository[]> => {
					const { githubService } = await import("@farmer/core/services");
					const rows = await githubService.listLinkedRepos(ctx, projectId);
					return rows.map(toApiProjectRepository);
				},
			}),
			POST: apiRoute({
				input: linkProjectRepoInput,
				raw: ({ params, body }: ApiRequest<OrgRowParams>) =>
					bodyWithPath(body, { projectId: params.id }),
				run: async (ctx, input): Promise<ApiProjectRepository[]> => {
					const { githubService } = await import("@farmer/core/services");
					await githubService.linkRepo(ctx, input);
					const rows = await githubService.listLinkedRepos(
						ctx,
						input.projectId,
					);
					return rows.map(toApiProjectRepository);
				},
			}),
		},
	},
});
