import { type ApiManagedTask, toApiManagedTask } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/tasks/managed` — Settings → Tasks: the built-ins
 * and the organization's own tasks, archived ones too, each with the number
 * of entries on it. Admins only, which `tasksService.listManaged` checks.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/tasks/managed")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiManagedTask[]> => {
					const { tasksService } = await import("@farmer/core/services");
					const rows = await tasksService.listManaged(ctx);
					return rows.map(toApiManagedTask);
				},
			}),
		},
	},
});
