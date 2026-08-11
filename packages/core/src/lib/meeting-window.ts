// How far the meeting sync reaches around "today".
//
// Pure, and its own module, because THREE callers have to agree on it and two of
// them cannot import each other: the background job, the manual "Sync now"
// button, and the write-on-read sync inside `listRange`. It used to live in
// `jobs/meeting-sync.ts`, where the service layer could not reach it — which is
// how the read path ended up with no window at all.
//
// A little into the past catches meetings rescheduled after they first synced;
// the forward reach pre-populates upcoming days so a meeting is already a block
// before anyone opens the time page.

import { addDaysToKey } from "./time";

const PAST_DAYS = 1;
const FUTURE_DAYS = 14;

/** The reconcile window for one user around a day-key already resolved in their
 *  org timezone. */
export const meetingSyncWindow = (todayKey: string) => ({
	from: addDaysToKey(todayKey, -PAST_DAYS),
	to: addDaysToKey(todayKey, FUTURE_DAYS),
});

/**
 * The part of `range` the sync is allowed to touch, or null when the two do not
 * overlap.
 *
 * This is what stops READING from creating work. `listRange` syncs the range the
 * caller asked for, and that range is whatever the user is looking at — up to
 * the 62 days `listTimeEntriesRangeInput` permits. Paging back through the Month
 * view therefore imported every meeting in those months as an unfiled entry, and
 * the unfiled banner nags over a 61-day window, so a few minutes of browsing
 * history produced dozens of chores. Browsing is not a request to import.
 */
export const clampToMeetingSyncWindow = (
	range: { from: string; to: string },
	todayKey: string,
): { from: string; to: string } | null => {
	const window = meetingSyncWindow(todayKey);
	const from = range.from > window.from ? range.from : window.from;
	const to = range.to < window.to ? range.to : window.to;
	return from <= to ? { from, to } : null;
};
