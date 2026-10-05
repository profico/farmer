import { type ApiProjectMember, toApiProjectMember } from "@farmer/core/api";
import {
	assignProjectMemberInput,
	listProjectMembersInput,
} from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { bodyWithPath } from "#/server/api-query.ts";
import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

const byId = z.object({ projectId: listProjectMembersInput });

/**
 * `/api/v1/orgs/$orgSlug/projects/$id/members` — the project's team.
 *
 * Reading the team needs a team lead or a PM on the project, or an admin. A
 * plain member sees no team. Adding somebody, or changing the role of
 * somebody already there, is the same write: `assignMember`. It is capped at
 * the caller's own rank, so a team lead cannot hand out PM, and it refuses an
 * archived person. Both answer the team as it is after the write.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/projects/$id/members/",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: byId,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					projectId: params.id,
				}),
				run: async (ctx, { projectId }): Promise<ApiProjectMember[]> => {
					const { projectsService } = await import("@farmer/core/services");
					const rows = await projectsService.listMembers(ctx, projectId);
					return rows.map(toApiProjectMember);
				},
			}),
			POST: apiRoute({
				input: assignProjectMemberInput,
				raw: ({ params, body }: ApiRequest<OrgRowParams>) =>
					bodyWithPath(body, { projectId: params.id }),
				run: async (ctx, input): Promise<ApiProjectMember[]> => {
					const { projectsService } = await import("@farmer/core/services");
					await projectsService.assignMember(ctx, input);
					const rows = await projectsService.listMembers(ctx, input.projectId);
					return rows.map(toApiProjectMember);
				},
			}),
		},
	},
});
