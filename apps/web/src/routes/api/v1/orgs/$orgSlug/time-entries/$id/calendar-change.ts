import { type ApiTimeEntry, toApiTimeEntry } from "@farmer/core/api";
import { useCalendarValuesInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import {
	type ApiRequest,
	apiRoute,
	type OrgRowParams,
} from "#/server/api-route.ts";

/**
 * `DELETE /api/v1/orgs/$orgSlug/time-entries/$id/calendar-change` — the
 * "updated by calendar" notice, dismissed: the entry stays as it is, and
 * `calendarChange` becomes null. The caller's own entry only.
 */
export const Route = createFileRoute(
	"/api/v1/orgs/$orgSlug/time-entries/$id/calendar-change",
)({
	server: {
		handlers: {
			DELETE: apiRoute({
				input: useCalendarValuesInput,
				raw: ({ params }: ApiRequest<OrgRowParams>) => ({
					timeEntryId: params.id,
				}),
				run: async (ctx, input): Promise<ApiTimeEntry> => {
					const { timeEntriesService } = await import("@farmer/core/services");
					await timeEntriesService.acknowledgeCalendarChange(ctx, input);
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
