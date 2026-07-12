import { queryOptions } from "@tanstack/react-query";
import {
	getGoogleCalendarStatus,
	listCalendarEventsForDay,
} from "#/server/google-calendar.ts";

export const googleCalendarStatusQuery = () =>
	queryOptions({
		queryKey: ["google-calendar", "connection-status"],
		queryFn: () => getGoogleCalendarStatus(),
	});

export const calendarEventsForDayQuery = (date: string) =>
	queryOptions({
		queryKey: ["google-calendar", "events", date],
		queryFn: () => listCalendarEventsForDay({ data: { date } }),
	});
