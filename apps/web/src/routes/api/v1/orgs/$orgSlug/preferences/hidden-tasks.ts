import type { ApiHiddenTasks } from "@farmer/core/api";
import { setTaskHiddenInput } from "@farmer/core/schema";
import type { Ctx } from "@farmer/core/services";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

const hiddenTasks = async (ctx: Ctx): Promise<ApiHiddenTasks> => {
	const { tasksService } = await import("@farmer/core/services");
	return { taskIds: await tasksService.hiddenIds(ctx) };
};

/**
 * `/api/v1/orgs/$orgSlug/preferences/hidden-tasks` — Preferences → Your
 * tasks: the tasks the caller switched off in this organization.
 *
 * The GET reads the list. The POST switches one task off (`hidden: true`) or
 * on again. The DELETE switches every task on again. Each answers the list as
 * it is after the change. The list only narrows the task picker: a task that
 * is switched off can still be logged.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/preferences/hidden-tasks",
)({
	server: {
		handlers: {
			GET: apiRoute({ input: NO_INPUT, run: hiddenTasks }),
			POST: apiRoute({
				input: setTaskHiddenInput,
				run: async (ctx, input) => {
					const { tasksService } = await import("@farmer/core/services");
					await tasksService.setHidden(ctx, input);
					return hiddenTasks(ctx);
				},
			}),
			DELETE: apiRoute({
				input: NO_INPUT,
				run: async (ctx) => {
					const { tasksService } = await import("@farmer/core/services");
					await tasksService.showAll(ctx);
					return hiddenTasks(ctx);
				},
			}),
		},
	},
});
