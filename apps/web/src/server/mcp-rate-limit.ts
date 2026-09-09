/**
 * A per-user ceiling on the MCP endpoint, held in memory.
 *
 * The thing on the other end of this connection is a loop, not a person. A UI
 * makes a request when somebody clicks; an agent makes one whenever it decides
 * to, and a badly-shaped prompt turns that into a poll. Two ceilings rather
 * than one, because the two failure modes cost different things: a thousand
 * reads a minute is load, and a thousand WRITES a minute is a timesheet nobody
 * can reconstruct — and reads are the ones a legitimate session makes many of.
 *
 * In memory, and so per process, which is the right shape here rather than a
 * concession: `startSchedulers` already assumes a single instance (see
 * CLAUDE.md's Production table), so there is no second web process for a
 * counter to disagree with. A deployment that grows one needs a shared store
 * for this and a lock for the jobs, in that order.
 *
 * A fixed window, not a sliding one. It admits a burst across a boundary — up
 * to twice the limit in a moment — and that is fine for a ceiling whose job is
 * to stop a runaway loop rather than to shape traffic.
 */

const WINDOW_MS = 60_000;

/** Requests per user per minute. Generous: one `tools/list` plus a step's worth
 *  of calls is a handful, so this bites a loop and not a session. */
const MAX_REQUESTS = 300;

/** Tool calls that are not `read`, per user per minute. */
const MAX_WRITES = 30;

/** Past this many tracked users, drop the expired buckets on the way in. The
 *  map is keyed by user id and a bucket is never removed when its window ends,
 *  so without this a long-lived process keeps a row per person who ever
 *  connected. */
const SWEEP_AT = 1_000;

type Bucket = { windowStartedAt: number; requests: number; writes: number };

const buckets = new Map<string, Bucket>();

const bucketFor = (userId: string, now: number): Bucket => {
	if (buckets.size >= SWEEP_AT) {
		for (const [key, bucket] of buckets) {
			if (now - bucket.windowStartedAt >= WINDOW_MS) buckets.delete(key);
		}
	}
	const existing = buckets.get(userId);
	if (existing && now - existing.windowStartedAt < WINDOW_MS) return existing;
	const fresh = { windowStartedAt: now, requests: 0, writes: 0 };
	buckets.set(userId, fresh);
	return fresh;
};

/** Seconds until this user's window rolls over — the `Retry-After` value. */
const retryAfter = (bucket: Bucket, now: number) =>
	Math.max(1, Math.ceil((bucket.windowStartedAt + WINDOW_MS - now) / 1000));

/**
 * Count one HTTP request against the user, and say whether it may proceed.
 *
 * Returns the retry delay rather than a bare boolean, so the caller can answer
 * with a `Retry-After` a client can actually wait on instead of one it has to
 * guess.
 */
export const admitMcpRequest = (
	userId: string,
): { ok: true } | { ok: false; retryAfterSeconds: number } => {
	const now = Date.now();
	const bucket = bucketFor(userId, now);
	bucket.requests += 1;
	return bucket.requests > MAX_REQUESTS
		? { ok: false, retryAfterSeconds: retryAfter(bucket, now) }
		: { ok: true };
};

/**
 * Count one write-tier tool call against the user, and say whether it may run.
 *
 * Separate from `admitMcpRequest` because a single HTTP request may carry
 * several calls, and because the two ceilings are about different harms.
 */
export const admitMcpWrite = (
	userId: string,
): { ok: true } | { ok: false; retryAfterSeconds: number } => {
	const now = Date.now();
	const bucket = bucketFor(userId, now);
	bucket.writes += 1;
	return bucket.writes > MAX_WRITES
		? { ok: false, retryAfterSeconds: retryAfter(bucket, now) }
		: { ok: true };
};

/** Drop every counter. Tests only — nothing in the app resets a window. */
export const resetMcpRateLimits = () => buckets.clear();
