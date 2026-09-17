import type { ApiCopyResult } from "@farmer/core/api";
import { copyWeekEntriesInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/time-entries/copy-week` — `farmer copy week`.
 * A day that would pass 24 hours is left alone and named in `blockedDays`,
 * rather than costing the other six.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/time-entries/copy-week",
)({
	server: {
		handlers: {
			POST: apiRoute({
				input: copyWeekEntriesInput,
				run: async (ctx, input): Promise<ApiCopyResult> => {
					const { timeEntriesService } = await import("@farmer/core/services");
					const result = await timeEntriesService.copyWeek(ctx, input);

					return {
						copied: result.copied,
						skipped: result.skipped,
						blockedDays: result.blockedDays,
					};
				},
			}),
		},
	},
});
