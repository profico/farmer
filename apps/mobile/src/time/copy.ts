import type { CopyResult } from "@farmer/api-client";

import { addDays } from "../lib/days";

/**
 * "Copy the previous day" and "Copy the previous week": the backfill for a
 * day or a week that looks like the one before it. The server skips what is
 * already there, so a second copy writes nothing, and it refuses a day of a
 * week copy that would pass 24 hours.
 */

export const copyDayBody = (day: string) => ({
	fromDate: addDays(day, -1),
	toDate: day,
});

export const copyWeekBody = (weekStart: string) => ({
	fromWeekStart: addDays(weekStart, -7),
	toWeekStart: weekStart,
});

const entries = (count: number) =>
	count === 1 ? "1 entry" : `${count} entries`;

/** What a day copy did, in one line. */
export const copyDayMessage = (result: CopyResult) => {
	if (result.copied === 0) {
		return result.skipped > 0
			? "The entries of the day before are already here."
			: "The day before has nothing to copy.";
	}
	return result.skipped > 0
		? `Copied ${entries(result.copied)}. ${result.skipped} were already here.`
		: `Copied ${entries(result.copied)}.`;
};

/** What a week copy did. A warning when a day was left alone because it
 *  would pass 24 hours. */
export const copyWeekMessage = (result: CopyResult) => {
	const parts: string[] = [];
	if (result.copied > 0) parts.push(`Copied ${entries(result.copied)}`);
	if (result.skipped > 0) parts.push(`${result.skipped} already here`);
	const blocked = result.blockedDays.length;
	if (blocked > 0) {
		parts.push(
			blocked === 1
				? "1 day would pass 24 hours"
				: `${blocked} days would pass 24 hours`,
		);
	}
	return {
		message:
			parts.length === 0
				? "The week before has nothing to copy."
				: `${parts.join(", ")}.`,
		warning: blocked > 0,
	};
};
