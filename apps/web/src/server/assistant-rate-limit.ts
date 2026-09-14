/**
 * A per-user ceiling on assistant turns, held in memory.
 *
 * Every turn is at least one paid completion against the organization's own
 * OpenRouter key, and often several (one per tool step, plus the title). A
 * person typing does not come near this; a script posting to the stream route,
 * or a tab stuck in a retry loop, spends that key as fast as the model can
 * answer — and unlike MCP, nothing here had a ceiling at all.
 *
 * Same shape as `api-rate-limit.ts`, and in memory for the same reason: this
 * deployment is one process (see CLAUDE.md's Production table), so there is no
 * second counter to disagree with. A fixed window rather than a sliding one,
 * which admits a burst across a boundary; the job is to stop a runaway, not to
 * shape traffic.
 */

const WINDOW_MS = 60_000;

/** Turns per user per minute. An approval is a turn too, and a busy person
 *  answering a run of cards sends a few a minute — so this stays well above
 *  that and well below what a loop does. */
const MAX_TURNS = 20;

/** Past this many tracked users, drop the expired buckets on the way in. A
 *  bucket is never removed when its window ends, so without this a long-lived
 *  process keeps a row per person who ever asked anything. */
const SWEEP_AT = 1_000;

type Bucket = { windowStartedAt: number; turns: number };

const buckets = new Map<string, Bucket>();

const bucketFor = (userId: string, now: number): Bucket => {
	if (buckets.size >= SWEEP_AT) {
		for (const [key, bucket] of buckets) {
			if (now - bucket.windowStartedAt >= WINDOW_MS) buckets.delete(key);
		}
	}
	const existing = buckets.get(userId);
	if (existing && now - existing.windowStartedAt < WINDOW_MS) return existing;
	const fresh = { windowStartedAt: now, turns: 0 };
	buckets.set(userId, fresh);
	return fresh;
};

/**
 * Count one turn against the user, and say whether it may run.
 *
 * Returns the retry delay rather than a bare boolean, so the route can send a
 * `Retry-After` and a message that names a real number of seconds.
 */
export const admitAssistantTurn = (
	userId: string,
): { ok: true } | { ok: false; retryAfterSeconds: number } => {
	const now = Date.now();
	const bucket = bucketFor(userId, now);
	bucket.turns += 1;
	if (bucket.turns <= MAX_TURNS) return { ok: true };
	return {
		ok: false,
		retryAfterSeconds: Math.max(
			1,
			Math.ceil((bucket.windowStartedAt + WINDOW_MS - now) / 1000),
		),
	};
};

/** Drop every counter. Tests only — nothing in the app resets a window. */
export const resetAssistantRateLimits = () => buckets.clear();
