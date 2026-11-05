import { type ApiTask, toApiTask } from "@farmer/core/api";
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
 * `GET /api/v1/orgs/$orgSlug/projects/$id/tasks` — the tasks that an entry on
 * this project may take. Every project offers every live task of the
 * organization and the built-ins, so this is not a list a PM edits.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/projects/$id/tasks",
)({
	server: {
		handlers: {
			GET: apiRoute({
				input: byId,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					projectId: params.id,
				}),
				run: async (ctx, { projectId }): Promise<ApiTask[]> => {
					const { projectsService } = await import("@farmer/core/services");
					const rows = await projectsService.listTasks(ctx, projectId);
					return rows.map(toApiTask);
				},
			}),
		},
	},
});
