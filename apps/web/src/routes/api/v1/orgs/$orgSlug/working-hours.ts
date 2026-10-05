import {
	type ApiWorkingHoursDay,
	toApiWorkingHoursDay,
} from "@farmer/core/api";
import { upsertWorkingHoursDayInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, NO_INPUT } from "#/server/api-route.ts";

/**
 * `GET` and `PATCH /api/v1/orgs/$orgSlug/working-hours` — the caller's week on
 * Settings → My schedule. The GET answers all seven days, 0 (Sunday) to 6, with
 * the default for a day that was never saved. The PATCH saves one day, named
 * by `dayOfWeek`. It is not a partial patch: it replaces the whole day, and a
 * time that is not sent is cleared.
 *
 * The schedule shapes the fill blocks, the time-off spans and when a reminder
 * reaches the person. It is not a target: the target is the hour fund.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/working-hours")({
	server: {
		handlers: {
			GET: apiRoute({
				input: NO_INPUT,
				run: async (ctx): Promise<ApiWorkingHoursDay[]> => {
					const { workingHoursService } = await import("@farmer/core/services");
					const days = await workingHoursService.list(ctx);
					return days.map(toApiWorkingHoursDay);
				},
			}),
			PATCH: apiRoute({
				input: upsertWorkingHoursDayInput,
				run: async (ctx, input): Promise<ApiWorkingHoursDay> => {
					const { workingHoursService } = await import("@farmer/core/services");
					return toApiWorkingHoursDay(
						await workingHoursService.upsertDay(ctx, input),
					);
				},
			}),
		},
	},
});
