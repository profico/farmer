/**
 * How a report writes a number, as `lib/report-format.ts` in the core does.
 * The app cannot import the core (ADR 0005). The separators are written by
 * hand: the Intl data of Hermes is not the same on each phone, and a report
 * must read the same on the web and on the phone.
 */

/** Groups of three digits with a separator: 1234567 -> "1.234.567". */
const group = (digits: string, separator: string) =>
	digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);

/** Hours as the Croatian accounting book writes them: 6557.5 hours is
 *  "6.557,50". The Time, Overtime and Absence reports show this form. */
export const formatReportHours = (totalSeconds: number) => {
	const hundredths = Math.round((Math.abs(totalSeconds) / 3600) * 100);
	const sign = totalSeconds < 0 && hundredths > 0 ? "-" : "";
	const whole = Math.floor(hundredths / 100);
	const fraction = String(hundredths % 100).padStart(2, "0");
	return `${sign}${group(String(whole), ".")},${fraction}`;
};

/** Decimal hours for a CSV file: "7.50". A spreadsheet reads "7:30" as a
 *  time of day. */
export const formatDecimalHours = (totalSeconds: number) =>
	(totalSeconds / 3600).toFixed(2);

/** Working days, written as the hours are. Only for reading: the hours are
 *  the unit. */
export const formatReportDays = (
	totalSeconds: number,
	workingDaySeconds: number,
) =>
	workingDaySeconds > 0
		? formatReportHours((totalSeconds / workingDaySeconds) * 3600)
		: "-";

/** A count, with the dot between the groups of three: "1.204". */
export const formatCount = (value: number) =>
	group(String(Math.round(value)), ".");

/** "1 entry", "3 entries". */
export const plural = (count: number, one: string, many: string) =>
	`${formatCount(count)} ${count === 1 ? one : many}`;
