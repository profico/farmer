import {
	type ApiManagedTask,
	type ApiTaskList,
	toApiManagedTask,
	toApiTask,
} from "@farmer/core/api";
import { createTaskInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/tasks` — both task lists. `listSelectable`
 * leaves absence out by design, since it feeds the worked-time picker, and
 * that would leave `farmer off` with no way to learn the id of the only kind
 * of task it takes. The same gap the assistant's `list_tasks` closes.
 *
 * `POST` adds a task to the organization's list. Admins only, which
 * `tasksService.create` checks, as on Settings → Tasks.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/tasks/")({
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
			POST: apiRoute({
				input: createTaskInput,
				run: async (ctx, input): Promise<ApiManagedTask> => {
					const { tasksService } = await import("@farmer/core/services");
					const created = await tasksService.create(ctx, input);
					const rows = await tasksService.listManaged(ctx);
					const row = rows.find((managed) => managed.id === created.id);
					if (!row) throw new Error("Task not found");
					return toApiManagedTask(row);
				},
			}),
		},
	},
});
