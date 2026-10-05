import {
	type ApiProjectOverview,
	toApiProjectOverview,
} from "@farmer/core/api";
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
 * `GET /api/v1/orgs/$orgSlug/projects/$id/overview` — the all-time figures at
 * the top of a project's page. A team lead or a PM on the project, or an
 * admin: a plain member sees nothing at project level.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/projects/$id/overview",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: byId,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					projectId: params.id,
				}),
				run: async (ctx, { projectId }): Promise<ApiProjectOverview> => {
					const { projectsService } = await import("@farmer/core/services");
					return toApiProjectOverview(
						await projectsService.overview(ctx, projectId),
					);
				},
			}),
		},
	},
});
