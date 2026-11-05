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
 * `POST /api/v1/orgs/$orgSlug/projects/$id/restore` — restores an archived project.
 * A PM or an admin, which `projectsService.unarchive` checks.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/projects/$id/restore",
)({
	server: {
		handlers: {
			POST: apiRoute({
				input: byId,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					projectId: params.id,
				}),
				run: async (ctx, { projectId }): Promise<ApiProjectDetail> => {
					const { projectsService } = await import("@farmer/core/services");
					await projectsService.unarchive(ctx, projectId);
					return toApiProjectDetail(await projectsService.get(ctx, projectId));
				},
			}),
		},
	},
});
