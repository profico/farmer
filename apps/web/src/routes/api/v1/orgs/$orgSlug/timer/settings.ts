import type { ApiTimerSettings } from "@farmer/core/api";
import { timerSettingsInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET` and `PATCH /api/v1/orgs/$orgSlug/timer/settings` — the caller's timer
 * limit, as on Settings → My schedule. A timer that runs past `maxSeconds` is
 * dropped and logs nothing. The limit is from one hour to 24 hours.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/timer/settings")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiTimerSettings> => {
					const { timersService } = await import("@farmer/core/services");
					const { maxSeconds } = await timersService.settings(ctx);
					return { maxSeconds };
				},
			}),
			PATCH: apiRoute({
				input: timerSettingsInput,
				run: async (ctx, input): Promise<ApiTimerSettings> => {
					const { timersService } = await import("@farmer/core/services");
					const { maxSeconds } = await timersService.setSettings(ctx, input);
					return { maxSeconds };
				},
			}),
		},
	},
});
