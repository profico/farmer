import { type ApiProjectDetail, toApiProjectDetail } from "@farmer/core/api";
import { createProjectInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `/api/v1/orgs/$orgSlug/projects` — the projects the caller may open, and a
 * new project.
 *
 * The list is `projectsService.list`: every project for an admin, and the
 * caller's own projects (plus the ones open to the organization) for anybody
 * else. The service decides the money and the stats. It sends no money to a
 * person who may not see it, and a plain member gets the sums of their own
 * hours only (`stats.scope` is `own`).
 *
 * Creating a project is open to an admin and to a PM or team lead on any
 * project. The service checks that, and makes the creator the PM.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/projects/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiProjectDetail[]> => {
					const { projectsService } = await import("@farmer/core/services");
					const rows = await projectsService.list(ctx);
					return rows.map(toApiProjectDetail);
				},
			}),
			POST: apiRoute({
				input: createProjectInput,
				run: async (ctx, input): Promise<ApiProjectDetail> => {
					const { projectsService } = await import("@farmer/core/services");
					return toApiProjectDetail(await projectsService.create(ctx, input));
				},
			}),
		},
	},
});
