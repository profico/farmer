import { queryOptions } from "@tanstack/react-query";
import {
	getGoogleCalendarStatus,
	listCalendarEventsForDay,
} from "#/server/google-calendar.ts";
import { queryKeys } from "./keys.ts";

export const googleCalendarStatusQuery = () =>
	queryOptions({
		queryKey: [...queryKeys.googleCalendar, "connection-status"],
		queryFn: () => getGoogleCalendarStatus(),
	});

export const calendarEventsForDayQuery = (date: string) =>
	queryOptions({
		queryKey: [...queryKeys.googleCalendar, "events", date],
		queryFn: () => listCalendarEventsForDay({ data: { date } }),
	});
