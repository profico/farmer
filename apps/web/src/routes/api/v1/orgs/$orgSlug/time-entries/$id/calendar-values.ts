import { type ApiTimeEntry, toApiTimeEntry } from "@farmer/core/api";
import { useCalendarValuesInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/time-entries/$id/calendar-values` — the
 * "updated by calendar" notice, answered with "use the calendar's": the
 * entry takes the day and the length that the calendar has now. The caller's
 * own entry only. Refused when the entry holds commits or pull requests and
 * the day would change.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/time-entries/$id/calendar-values",
)({
	server: {
		handlers: {
			POST: apiRoute({
				input: useCalendarValuesInput,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					timeEntryId: params.id,
				}),
				run: async (ctx, input): Promise<ApiTimeEntry> => {
					const { timeEntriesService } = await import("@farmer/core/services");
					await timeEntriesService.useCalendarValues(ctx, input);
					// The notice stays until the person dismisses it, as on the web.
					const entry = await timeEntriesService.getOwnDetailed(
						ctx,
						input.timeEntryId,
					);
					if (!entry) throw new Error("Time entry not found");
					return toApiTimeEntry(entry);
				},
			}),
		},
	},
});
