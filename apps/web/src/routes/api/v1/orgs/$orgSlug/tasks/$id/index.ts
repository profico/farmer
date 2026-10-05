import { type ApiManagedTask, toApiManagedTask } from "@farmer/core/api";
import { updateTaskInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import {
	type ApiRequest,
	apiRoute,
	bodyWithPath,
	type OrgRowParams,
} from "#/server/api-route.ts";

/**
 * `PATCH /api/v1/orgs/$orgSlug/tasks/$id` — changes the name, the group, the
 * colour or the description of a task. Admins only, and a built-in is
 * refused. `tasksService.update` checks both.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/tasks/$id/")({
	server: {
		handlers: {
			PATCH: apiRoute({
				input: updateTaskInput,
				raw: ({ params, body }: ApiRequest<OrgRowParams>) =>
					bodyWithPath(body, { taskId: params.id }),
				run: async (ctx, input): Promise<ApiManagedTask> => {
					const { tasksService } = await import("@farmer/core/services");
					await tasksService.update(ctx, input);
					const rows = await tasksService.listManaged(ctx);
					const row = rows.find((managed) => managed.id === input.taskId);
					if (!row) throw new Error("Task not found");
					return toApiManagedTask(row);
				},
			}),
		},
	},
});
