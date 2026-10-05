import { type ApiProjectMember, toApiProjectMember } from "@farmer/core/api";
import {
	changeProjectMemberRoleInput,
	removeProjectMemberInput,
} from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { type ApiRequest, apiRoute, bodyWithPath } from "#/server/api-route.ts";

type MemberParams = { orgSlug: string; id: string; userId: string };

/**
 * `/api/v1/orgs/$orgSlug/projects/$id/members/$userId` — one person on the
 * team.
 *
 * A change takes the new `role` and goes through `assignMember`, with the
 * same cap on the caller's rank as an addition. A removal deactivates the
 * assignment: the person keeps their history on the project, and the
 * assignment grants nothing from now on. Both answer the team after the
 * write.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/projects/$id/members/$userId",
)({
	server: {
		handlers: {
			PATCH: apiRoute({
				input: changeProjectMemberRoleInput,
				raw: ({ params, body }: ApiRequest<MemberParams>) =>
					bodyWithPath(body, { projectId: params.id, userId: params.userId }),
				run: async (ctx, input): Promise<ApiProjectMember[]> => {
					const { projectsService } = await import("@farmer/core/services");
					await projectsService.assignMember(ctx, input);
					const rows = await projectsService.listMembers(ctx, input.projectId);
					return rows.map(toApiProjectMember);
				},
			}),
			DELETE: apiRoute({
				input: removeProjectMemberInput,
				raw: ({ params }: ApiRequest<MemberParams>) => ({
					projectId: params.id,
					userId: params.userId,
				}),
				run: async (ctx, input): Promise<ApiProjectMember[]> => {
					const { AccessError, projectsService } =
						await import("@farmer/core/services");
					await projectsService.removeMember(ctx, input);
					// A lead who removed themselves may not read the team any more.
					// The removal happened, so the answer is an empty team, not a 403.
					try {
						const rows = await projectsService.listMembers(
							ctx,
							input.projectId,
						);
						return rows.map(toApiProjectMember);
					} catch (error) {
						if (error instanceof AccessError) return [];
						throw error;
					}
				},
			}),
		},
	},
});
