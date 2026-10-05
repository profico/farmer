import { type ApiManagedTask, toApiManagedTask } from "@farmer/core/api";
import { taskIdInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

const byId = z.object({ taskId: taskIdInput });

/**
 * `POST /api/v1/orgs/$orgSlug/tasks/$id/archive` — archives a task. Its entries keep it. A built-in cannot be archived.
 * Admins only, which `tasksService.archive` checks.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/tasks/$id/archive")(
	{
		server: {
			handlers: {
				POST: apiRoute({
					input: byId,
					raw: ({ params }: ApiRequest<OrgRowParams>) => ({
						taskId: params.id,
					}),
					run: async (ctx, { taskId }): Promise<ApiManagedTask> => {
						const { tasksService } = await import("@farmer/core/services");
						await tasksService.archive(ctx, taskId);
						const rows = await tasksService.listManaged(ctx);
						const row = rows.find((managed) => managed.id === taskId);
						if (!row) throw new Error("Task not found");
						return toApiManagedTask(row);
					},
				}),
			},
		},
	},
);
