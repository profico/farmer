import { queryOptions } from "@tanstack/react-query";

import {
	getGoogleCalendarStatus,
	listCalendarEventsForDay,
} from "#/server/google-calendar.ts";

import { queryKeys } from "./keys.ts";

export const googleCalendarStatusQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).googleCalendar, "connection-status"],
		queryFn: () => getGoogleCalendarStatus(),
	});

export const calendarEventsForDayQuery = (org: string, date: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).googleCalendar, "events", date],
		queryFn: () => listCalendarEventsForDay({ data: { date } }),
		// The dialog asks on each open; a minute-old list is fresh enough.
		staleTime: 60_000,
	});
