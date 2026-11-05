import {
	type ApiProjectRepository,
	toApiProjectRepository,
} from "@farmer/core/api";
import { unlinkProjectRepoInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { type ApiRequest, apiRoute } from "#/server/api-route.ts";

type RepositoryParams = { orgSlug: string; id: string; repositoryId: string };

const byLink = z.object({
	projectId: unlinkProjectRepoInput,
	repositoryId: unlinkProjectRepoInput,
});

/**
 * `DELETE /api/v1/orgs/$orgSlug/projects/$id/repositories/$repositoryId` —
 * unlink a repository from a project. Admin only. `$repositoryId` is the
 * link's `id`. The commits already attached to entries stay. Answers the
 * project's repositories after the change.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/projects/$id/repositories/$repositoryId",
)({
	server: {
		handlers: {
			DELETE: apiRoute({
				input: byLink,
				raw: ({ params }: ApiRequest<RepositoryParams>) => ({
					projectId: params.id,
					repositoryId: params.repositoryId,
				}),
				run: async (
					ctx,
					{ projectId, repositoryId },
				): Promise<ApiProjectRepository[]> => {
					const { githubService, requireAdmin } =
						await import("@farmer/core/services");
					// Before the read below, so a member learns nothing from it.
					await requireAdmin(ctx);
					// The service unlinks by the link's own id. The path names the
					// project too, so the link must be on that project.
					const linked = await githubService.listLinkedRepos(ctx, projectId);
					if (!linked.some((row) => row.id === repositoryId)) {
						throw new Error("Repository link not found");
					}
					await githubService.unlinkRepo(ctx, repositoryId);
					const rows = await githubService.listLinkedRepos(ctx, projectId);
					return rows.map(toApiProjectRepository);
				},
			}),
		},
	},
});
