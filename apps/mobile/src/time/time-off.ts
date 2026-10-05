import { daysBetween } from "./calendar";

/**
 * Time off over a range of days. The server books each working day in the
 * range at the person's own hours, and skips weekends, public holidays and
 * days that are already off. These rules only let the form say why it
 * cannot send; the server checks them again.
 */

/** The longest range one booking takes (`logAbsenceRangeInput`). */
export const MAX_SPAN_DAYS = 62;

export const spanError = (from: string, to: string) => {
	const span = daysBetween(from, to);
	if (span < 0) return "The last day is before the first day.";
	if (span > MAX_SPAN_DAYS) {
		return `The range is longer than ${MAX_SPAN_DAYS} days. Book it in two parts.`;
	}
	return null;
};

/** A new first day moves the last day with it, so the range never reads
 *  backwards. */
export const withFirstDay = (
	range: { from: string; to: string },
	from: string,
) => ({
	from,
	to: from > range.to ? from : range.to,
});

/** A skipped day's reason, for the person who booked it. A reason that is
 *  not known is shown as the server wrote it. */
export const skipReasonLabel = (reason: string) => {
	switch (reason) {
		case "public holiday":
			return "Public holiday";
		case "not a working day for this person":
			return "Not a working day for you";
		case "absence already logged":
			return "Already booked off";
		case "could not be logged":
			return "Could not be booked";
		default:
			return reason;
	}
};
