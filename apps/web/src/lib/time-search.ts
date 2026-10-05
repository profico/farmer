// The search params of the timesheet routes.
//
// A URL that holds today's date is a bookmark of that one day. Open it
// tomorrow, and the page shows an old day. These helpers keep the current day,
// the current week and the current month out of the URL. A route with no param
// reads the live "today", so the page stays current.
//
// Every link and every navigation to a timesheet route must use one of these.
// Do not write `search={{ date }}` by hand.

/** The search of the Day route. `date` is left out when `day` is today. */
export function dateSearch(day: string, today: string): { date?: string } {
	return day === today ? {} : { date: day };
}

/**
 * The search of the Week route. `weekStart` is left out when it is the
 * current week. `currentWeekStart` is the start of the week that holds today.
 */
export function weekSearch(
	weekStart: string,
	currentWeekStart: string,
): { weekStart?: string } {
	return weekStart === currentWeekStart ? {} : { weekStart };
}

/** The search of the Month route. `month` is left out for the current month. */
export function monthSearch(month: string, today: string): { month?: string } {
	return month === today.slice(0, 7) ? {} : { month };
}
