import { type ApiProjectDetail, toApiProjectDetail } from "@farmer/core/api";
import { projectIdInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

const byId = z.object({ projectId: projectIdInput });

/**
 * `GET /api/v1/orgs/$orgSlug/projects/$id` — the head of a project's page.
 *
 * On the same scope as the list: an Admin, an assignment, or a project open
 * to the organization. The service decides each figure. Below PM rank the
 * three money fields are null. Below Team Lead rank the hours are the
 * caller's own (`statsScope: "own"`), because a plain member sees nothing at
 * project level.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/projects/$id/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: byId,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					projectId: params.id,
				}),
				run: async (ctx, { projectId }): Promise<ApiProjectDetail> => {
					const { projectsService } = await import("@farmer/core/services");
					return toApiProjectDetail(await projectsService.get(ctx, projectId));
				},
			}),
		},
	},
});
