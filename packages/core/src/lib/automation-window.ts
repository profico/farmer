// What part of the calendar an automation is allowed to WRITE to.
//
// Three engines materialize entries nobody typed: the recurring block
// materializer, the calendar meeting sync, and the commit work-time blocks.
// They share one window, anchored on today, that never reaches forward:
//
//   to   = today (in the ORG timezone: one midnight for the whole org),
//          or yesterday for an engine that may only write to days that are over
//   from = the latest of: today - GRACE_DAYS
//                         the day the switch was turned on
//                         the day after the org's automation lock
//
// The window has no past leak. `sinceKey` is only a floor: alone, it would
// let an engine file months of entries across timesheets that are already
// filed.
//
// The window has no future leak. A row on a day that is not over is a claim,
// not a record. It counts in reports, and it is rewritten when the calendar
// changes. `dayAssemblyService.suggest` shows the future without a write.
//
// GRACE_DAYS is a recovery budget for a writer that did not run (worker down,
// token revoked, a meeting that moved), not a backfill policy. Three days
// covers a weekend outage. Keep it short: a sync can rewrite every day inside
// the window, and that can revert a manual correction.
//
// Pure and its own module because the callers cannot import each other: the
// per-user pass in the service layer, the background job, and the manual "Sync
// now" button must agree on the same answer.

import { addDaysToKey, dayKeyInTz } from "./time";

/** How many days back an automation may still revisit. See the note above:
 *  this is downtime recovery, not a backfill policy. */
export const AUTOMATION_GRACE_DAYS = 3;

/** The day an automation switched on, as a day key in the org's timezone.
 *  Null when it has no recorded start and is therefore unfloored. */
export const enabledSinceKey = (
	since: Date | null | undefined,
	tz: string,
): string | null => (since ? dayKeyInTz(since, tz) : null);

/** What can narrow the window. Every field is optional and every field only ever
 *  SHRINKS the result — nothing here widens it. */
export type AutomationBounds = {
	/** The day this particular switch was turned on. */
	since?: string | null;
	/**
	 * The org's automation lock (`orgSettings.automationLockedThrough`): the last
	 * day no automation may write to.
	 *
	 * Not redundant with the grace window, despite grace being short. On the 1st
	 * through the 3rd of every month the grace window reaches back into the
	 * previous month — so without this, the one period most likely to have been
	 * reconciled and invoiced is also the one automation can still add hours to,
	 * every single month.
	 */
	lockedThrough?: string | null;
	/**
	 * Stop at yesterday: only write to days that are OVER.
	 *
	 * The one ceiling here, and it exists for the commit work-time engine. That
	 * engine's block claims "the rest of the working day", sized from the day's
	 * whole target — a number that is only true once the day has been worked. Run
	 * against today, the 09:15 commit that wakes it produces a 7.5-hour block at
	 * 09:20, and since the engine guards on `te_fill_day_uidx` with
	 * `onConflictDoNothing`, no later tick ever corrects it.
	 *
	 * The meeting engine does not want this: a meeting contributes its own length,
	 * which is known as soon as the event is, so importing today's meetings during
	 * today is right. Nor does the recurring materializer, whose blocks are a fixed
	 * duration off a rule.
	 *
	 * Today is not lost, only un-automated: "Sync now" and Assemble my day both
	 * propose today's fill on demand, which is the read path asking, not a
	 * background job deciding.
	 */
	completeDaysOnly?: boolean;
};

/**
 * The days an automation may write to, or null when there are none.
 *
 * Null means "don't run this engine at all", and happens whenever the bounds
 * cross: a switch turned on later than the day we're anchored to (clock skew, or
 * a stamp written ahead of the org's midnight), a lock covering today, or
 * `completeDaysOnly` on a window that had only today left in it.
 *
 * Every bound narrows and none widens. In particular a null `since` still gets
 * the grace window, not the whole past: rows that predate the `*_since` columns
 * are grandfathered, and grandfathering must not mean unbounded.
 */
export const automationWriteWindow = (
	todayKey: string,
	bounds: AutomationBounds = {},
): { from: string; to: string } | null => {
	const from = [
		addDaysToKey(todayKey, -AUTOMATION_GRACE_DAYS),
		bounds.since ?? null,
		// The lock names the last CLOSED day, so the first writable one is the day
		// after it.
		bounds.lockedThrough ? addDaysToKey(bounds.lockedThrough, 1) : null,
	]
		.filter((key): key is string => key !== null)
		.reduce((latest, key) => (key > latest ? key : latest));

	const to = bounds.completeDaysOnly ? addDaysToKey(todayKey, -1) : todayKey;

	return from > to ? null : { from, to };
};
