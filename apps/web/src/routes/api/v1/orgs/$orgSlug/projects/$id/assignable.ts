import { type ApiPersonRef, toApiPersonRef } from "@farmer/core/api";
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
 * `GET /api/v1/orgs/$orgSlug/projects/$id/assignable` — the people who can
 * join the team: every active member of the organization. A team lead or a
 * PM on the project, or an admin, the same people who may add somebody.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/projects/$id/assignable",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: byId,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					projectId: params.id,
				}),
				run: async (ctx, { projectId }): Promise<ApiPersonRef[]> => {
					const { projectsService } = await import("@farmer/core/services");
					const rows = await projectsService.listAssignable(ctx, projectId);
					return rows.map(toApiPersonRef);
				},
			}),
		},
	},
});
