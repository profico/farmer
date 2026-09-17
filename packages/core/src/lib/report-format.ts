// How a report writes a number down.
//
// The screen, the CSV export and the PDF are three renderings of the same
// figures, and they were formatting them three ways: the screen's own
// `formatHoursShort` dropped the thousands separator the PDF used and wrote a
// zero total as "0m" where the PDF wrote "0h", and the CSV's decimal-hours rule
// existed as an inline `.toFixed(2)` with the reason in a comment beside it.
//
// This module holds no layout and no dependencies, which is the point: the
// browser imports it directly, alongside the service layer.

/** A duration as hours and minutes: 23400 -> "6h 30m", 3600 -> "1h", 0 -> "0h",
 *  -5400 -> "-1h 30m". Thousands are grouped, because an org-wide monthly total
 *  is four digits.
 *
 *  Rounds to the minute FIRST and splits that into hours and minutes second.
 *  Splitting first rounded the remainder alone, so 3599s came out as "60m",
 *  and floored a negative figure away from zero before taking its remainder,
 *  so -5400s came out as "-2h -30m". The sign is written once,
 *  in front, and a figure that rounds to nothing is "0h" rather than "-0h". */
export const formatHoursLabel = (totalSeconds: number): string => {
	const totalMinutes = Math.round(Math.abs(totalSeconds) / 60);

	if (totalMinutes === 0) return "0h";
	const sign = totalSeconds < 0 ? "-" : "";
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	const h = hours.toLocaleString("en-US");

	if (minutes === 0) return `${sign}${h}h`;

	if (hours === 0) return `${sign}${minutes}m`;

	return `${sign}${h}h ${minutes}m`;
};

/** Whole-hour figure for a headline stat, where the unit is rendered
 *  separately as its own suffix. */
export const formatWholeHoursValue = (totalSeconds: number): string =>
	Math.round(totalSeconds / 3600).toLocaleString("en-US");

/** Hours the way the Croatian accounting book writes them: decimal, two
 *  places, hr-HR separators — 6557.5 hours is "6.557,50". The Time report and
 *  the Breakdown show this form (the COO signed it off against Harvest); the
 *  CSV keeps the plain `formatDecimalHours` below, which a spreadsheet parses. */
const HR_HOURS = new Intl.NumberFormat("hr-HR", {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

export const formatReportHours = (totalSeconds: number): string =>
	HR_HOURS.format(totalSeconds / 3600);

/** Decimal hours — the CSV form, and only the CSV form. The destination is a
 *  spreadsheet, where "7:30" is a time of day and would sum as one. */
export const formatDecimalHours = (totalSeconds: number): string =>
	(totalSeconds / 3600).toFixed(2);

/** Working days, written like the hours above (hr-HR, two places): the
 *  Absence report's Days column, for reading only — hours are the unit. The
 *  divisor is the org's working day, not a hardcoded 8h. */
export const formatReportDays = (
	totalSeconds: number,
	workingDaySeconds: number,
): string =>
	workingDaySeconds > 0
		? HR_HOURS.format(totalSeconds / workingDaySeconds)
		: "—";

/** A percentage, or the em dash that stands for "not measured". */
export const formatPctLabel = (pct: number | null): string =>
	pct == null ? "—" : `${pct}%`;

// (2026, 7) -> "July 2026". Month-scoped because everything the PDF draws from —
// Final hours, Expected hours — only exists per closed month.
export const formatMonthLabel = (year: number, month: number): string =>
	new Intl.DateTimeFormat("en-US", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(Date.UTC(year, month - 1, 15)));

// (2026, 7) -> "Jul 2026" — for the running header's compact period.
export const formatMonthShortLabel = (year: number, month: number): string =>
	new Intl.DateTimeFormat("en-US", {
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(Date.UTC(year, month - 1, 15)));
