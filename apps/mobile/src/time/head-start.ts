import { formatHours, MAX_DAY_SECONDS } from "../lib/duration";

/**
 * A head start: time worked before the timer was started (ADR 0003, the
 * amendment of 22 September 2026). It counts towards the timer limit, so
 * it must be shorter than the limit, and shorter than a day. The web dialog
 * and the CLI read it with `parseHeadStart`; this is the same rule.
 */

/** The step of the head start control. */
export const HEAD_START_STEP_SECONDS = 5 * 60;

/** The bound a head start must stay under. Without the person's limit, a
 *  day. */
export const headStartLimit = (capSeconds: number | undefined) =>
	Math.min(capSeconds ?? MAX_DAY_SECONDS, MAX_DAY_SECONDS);

export const headStartError = (seconds: number, limit: number) => {
	if (seconds <= 0 || seconds < limit) return null;
	return limit >= MAX_DAY_SECONDS
		? "A head start must be shorter than a day."
		: `A head start must be shorter than your timer limit of ${formatHours(limit)}.`;
};

/** The last step under the limit. */
export const lastHeadStart = (limit: number) =>
	Math.ceil(limit / HEAD_START_STEP_SECONDS) * HEAD_START_STEP_SECONDS -
	HEAD_START_STEP_SECONDS;

/** One step up or down, from zero to the last step under the limit. */
export const stepHeadStart = (
	seconds: number,
	steps: number,
	limit: number,
) => {
	const last = lastHeadStart(limit);
	const next = seconds + steps * HEAD_START_STEP_SECONDS;
	return Math.max(0, Math.min(next, last));
};
