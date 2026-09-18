import { type ApiTimerState, toApiTimer } from "@farmer/core/api";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/** `POST /api/v1/orgs/$orgSlug/timer/resume` — `farmer resume`. */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/timer/resume")({
	server: {
		handlers: {
			POST: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiTimerState> => {
					const { timersService } = await import("@farmer/core/services");
					return { timer: toApiTimer(await timersService.resume(ctx)) };
				},
			}),
		},
	},
});
