import type { ApiCopyResult } from "@farmer/core/api";
import { copyTimeEntriesInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/time-entries/copy-day` — `farmer copy day`.
 *
 * `blockedDays` is always empty here. A day copy that would pass 24 hours is
 * refused whole with `DayCapacityError`, which the pipeline answers as 422; the
 * list exists so a day copy and a week copy share one response type.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/time-entries/copy-day",
)({
	server: {
		handlers: {
			POST: apiRoute({
				input: copyTimeEntriesInput,
				run: async (ctx, input): Promise<ApiCopyResult> => {
					const { timeEntriesService } = await import("@farmer/core/services");
					const result = await timeEntriesService.copyDay(ctx, input);
					return {
						copied: result.copied,
						skipped: result.skipped,
						blockedDays: [],
					};
				},
			}),
		},
	},
});
