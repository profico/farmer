import { type ApiTimerState, toApiTimer } from "@farmer/core/api";
import { startTimerInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET`, `POST` and `DELETE /api/v1/orgs/$orgSlug/timer` — `farmer timer`,
 * `farmer start` and `farmer timer discard`.
 *
 * The GET answers `{ timer: null }` rather than nothing when nobody is timing:
 * `apiRoute` serialises whatever the handler returns, and `undefined` is not
 * JSON. A timer belongs to the person rather than to a workspace, so this may
 * answer with one running somewhere else — `organization.here` says so.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/timer/")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiTimerState> => {
					const { timersService } = await import("@farmer/core/services");
					const timer = await timersService.get(ctx);
					return { timer: timer ? toApiTimer(timer) : null };
				},
			}),
			POST: apiRoute({
				input: startTimerInput,
				run: async (ctx, input): Promise<ApiTimerState> => {
					const { timersService } = await import("@farmer/core/services");
					return { timer: toApiTimer(await timersService.start(ctx, input)) };
				},
			}),
			DELETE: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiTimerState> => {
					const { timersService } = await import("@farmer/core/services");
					await timersService.discard(ctx);
					return { timer: null };
				},
			}),
		},
	},
});
