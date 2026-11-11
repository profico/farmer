import { addDaysToKey, weekdayInTz } from "@farmer/core/lib/time";
import { useQuery } from "@tanstack/react-query";

import { chooseSuggestions } from "#/components/assistant/suggestions.ts";
import { useToday } from "#/hooks/use-today.ts";
import { useUnfiledCount } from "#/hooks/use-unfiled-count.ts";
import { myTargetsQuery } from "#/queries/compliance.ts";
import { googleCalendarStatusQuery } from "#/queries/google-calendar.ts";
import { timeEntriesRangeQuery } from "#/queries/time-entries.ts";

// shortcut: a public holiday counts as a working day here, so a holiday
// can offer "log the rest of today". Read the holidays query to fix it.
const isWeekday = (day: string, timezone: string) => {
	const weekday = weekdayInTz(day, timezone);
	return weekday !== 0 && weekday !== 6;
};

/** The empty chat's questions, from queries the app already holds. */
export function useSuggestions(orgSlug: string, timezone: string): string[] {
	const today = useToday(timezone);
	const yesterday = addDaysToKey(today, -1);
	const { data: targets } = useQuery(myTargetsQuery(orgSlug, today));
	const { data: entries } = useQuery(
		timeEntriesRangeQuery(orgSlug, yesterday, today),
	);
	const { data: calendar } = useQuery(googleCalendarStatusQuery(orgSlug));
	const unfiledCount = useUnfiledCount(orgSlug, timezone);

	const secondsOn = (day: string) =>
		entries
			? entries
					.filter((entry) => entry.date === day)
					.reduce((sum, entry) => sum + entry.durationSeconds, 0)
			: null;

	return chooseSuggestions({
		daySeconds: targets?.week.targetSeconds == null ? null : targets.daySeconds,
		todaySeconds: secondsOn(today),
		yesterdaySeconds: secondsOn(yesterday),
		todayIsWorkingDay: isWeekday(today, timezone),
		yesterdayIsWorkingDay: isWeekday(yesterday, timezone),
		unfiledCount,
		calendarConnected: calendar?.connected === true,
	});
}
