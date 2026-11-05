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
 * admin, as on the web page: a plain member gets 403, because a plain member
 * sees nothing at project level.
 *
 * The entries below those figures on the web page are the Time report's
 * detail for the project: `GET …/reports/time/detail?projectId=`.
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
