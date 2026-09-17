import { type ApiTaskList, toApiTask } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/tasks` — both task lists. `listSelectable`
 * leaves absence out by design, since it feeds the worked-time picker, and
 * that would leave `farmer off` with no way to learn the id of the only kind
 * of task it takes. The same gap the assistant's `list_tasks` closes.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/tasks")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiTaskList> => {
					const { tasksService } = await import("@farmer/core/services");

					const [tasks, absenceTasks] = await Promise.all([
						tasksService.listSelectable(ctx),
						tasksService.listAbsenceTasks(),
					]);

					return {
						tasks: tasks.map(toApiTask),
						absenceTasks: absenceTasks.map(toApiTask),
					};
				},
			}),
		},
	},
});
