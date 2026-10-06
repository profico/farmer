/**
 * The link to one day of the Time tab. The assistant cites a day with it,
 * and the Time tab reads the `date` param to open that day. Both sides use
 * this module, so they cannot disagree.
 */

/** The search param of the Time tab that names a day. */
export const DAY_PARAM = "date";

/** True for a day key, yyyy-MM-dd, of a real day of the calendar. */
export const isDayKey = (value: string | undefined): value is string => {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T12:00:00Z`);
	return (
		!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
	);
};

/** The route of the Time tab, open on `day`. */
export const timeDayRoute = (day: string) => ({
	pathname: "/" as const,
	params: { [DAY_PARAM]: day },
});
