// What part of a range an automation is allowed to WRITE to.
//
// Every engine that materializes entries on its own — the calendar sync, the
// commit work-time blocks, the recurring block materializer — runs over
// whatever range the caller happens to be reading. That range is the screen the
// person is looking at, so scrolling back through the Month view used to be
// enough to have three different engines file entries across months of already
// closed timesheets. Turning a switch on is a statement about how you want
// tomorrow to work; it is not a request to backfill the past.
//
// Pure and its own module because the callers cannot import each other: the
// service layer's write-on-read sync, the background job, and the manual "Sync
// now" button all have to agree on the same answer. `meeting-window` is the
// same idea bounded the other way — how far FORWARD the calendar sync reaches.

import { dayKeyInTz } from "./time";

/** The day an automation switched on, as a day key in the org's timezone.
 *  Null when it has no recorded start and is therefore unfloored. */
export const enabledSinceKey = (
	since: Date | null | undefined,
	tz: string,
): string | null => (since ? dayKeyInTz(since, tz) : null);

/**
 * `range` with its start pulled forward to `sinceKey`, or null when the range
 * ends before the automation ever existed — meaning there is nothing to sync
 * and the engine should not run at all.
 *
 * A null `sinceKey` leaves the range alone: rows that predate the column are
 * grandfathered rather than silently switched off.
 */
export const clampToEnabledSince = (
	range: { from: string; to: string },
	sinceKey: string | null,
): { from: string; to: string } | null => {
	if (!sinceKey) return range;
	if (range.to < sinceKey) return null;
	return { from: range.from > sinceKey ? range.from : sinceKey, to: range.to };
};
