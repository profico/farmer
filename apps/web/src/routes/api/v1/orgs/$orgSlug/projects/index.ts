import { toApiProject } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/projects` — the projects the caller may log time
 * against. `listMine`, not `list`: the question the CLI asks is "where can I
 * put these hours", and the projection leaves out the stats and money that
 * `enrichedProjects` carries.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/projects/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx) => {
					const { projectsService } = await import("@farmer/core/services");
					const rows = await projectsService.listMine(ctx);
					return rows.map(toApiProject);
				},
			}),
		},
	},
});
