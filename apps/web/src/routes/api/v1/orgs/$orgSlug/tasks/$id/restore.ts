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
 * `POST /api/v1/orgs/$orgSlug/tasks/$id/restore` — restores an archived task with its id, so its entries stay on it.
 * Admins only, which `tasksService.unarchive` checks.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/tasks/$id/restore")(
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
						await tasksService.unarchive(ctx, taskId);
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
