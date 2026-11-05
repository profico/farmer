import { type ApiCalendarEvent, toApiCalendarEvent } from "@farmer/core/api";
import { listCalendarEventsInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `GET /api/v1/orgs/$orgSlug/calendar/events?date=2026-10-06` — the timed
 * meetings on the caller's Google Calendar on one day of the organization,
 * for the meeting picker of the entry form. 422 when the calendar is not
 * connected.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/calendar/events")({
	server: {
		handlers: {
			GET: apiRoute({
				input: listCalendarEventsInput,
				run: async (ctx, input): Promise<ApiCalendarEvent[]> => {
					const { googleCalendarService } =
						await import("@farmer/core/services");
					const events = await googleCalendarService.listEventsForDay(
						ctx,
						input,
					);
					return events.map(toApiCalendarEvent);
				},
			}),
		},
	},
});
