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
const retryAfter = (bucket: { windowStartedAt: number }, now: number) =>
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

// ── Per caller address, BEFORE the credential is resolved ────────────────────
//
// The per-user ceilings above need a user id, and a user id costs a session
// lookup and a token lookup — database reads. So they only ever limited people
// who had already authenticated: a caller with no credential, or a garbage
// one, cost two queries per request with nothing counting them. These two run
// first, keyed on the address the request came from, and need no I/O at all.
//
// Two counters, because the two things they catch look different:
//  * a flood — any request at all, with a ceiling well above one user's 300 so
//    an office of agents behind one NAT address is not what it bites;
//  * guessing — requests whose credential resolved to nobody. A real client
//    fails exactly once (the 401 that starts its OAuth flow), so a small
//    budget here costs a legitimate caller nothing.
//
// The address comes from the proxy's headers, as nothing else reaches a server
// route. A deployment whose proxy does not overwrite them lets a caller choose
// its own key; that weakens this to a per-claimed-address limit, and the hard
// cap on the map below is what keeps it from also becoming a memory leak.

/** Requests per caller address per minute, authenticated or not. */
const MAX_REQUESTS_PER_ADDRESS = 1_200;

/** Requests per caller address per minute whose credential resolved to no one. */
const MAX_AUTH_FAILURES_PER_ADDRESS = 30;

/** The most addresses tracked at once. Past it the oldest bucket is dropped,
 *  which at worst forgives one address early — the alternative is a map an
 *  attacker grows by varying a header. */
const MAX_TRACKED_ADDRESSES = 10_000;

type AddressBucket = {
	windowStartedAt: number;
	requests: number;
	authFailures: number;
};

const addressBuckets = new Map<string, AddressBucket>();

const addressBucketFor = (address: string, now: number): AddressBucket => {
	const existing = addressBuckets.get(address);
	if (existing && now - existing.windowStartedAt < WINDOW_MS) return existing;
	if (addressBuckets.size >= SWEEP_AT) {
		for (const [key, bucket] of addressBuckets) {
			if (now - bucket.windowStartedAt >= WINDOW_MS) addressBuckets.delete(key);
		}
	}
	// Map iteration is insertion order, so the first key is the oldest window.
	while (addressBuckets.size >= MAX_TRACKED_ADDRESSES) {
		const oldest = addressBuckets.keys().next();
		if (oldest.done) break;
		addressBuckets.delete(oldest.value);
	}
	const fresh = { windowStartedAt: now, requests: 0, authFailures: 0 };
	// Delete first so a renewed window moves to the back of the eviction order.
	addressBuckets.delete(address);
	addressBuckets.set(address, fresh);
	return fresh;
};

/** The address a request came from, as the proxy in front of us reports it.
 *  `cf-connecting-ip` first because Cloudflare fronts this deployment and
 *  sets it itself; the first `x-forwarded-for` hop is the client's. Requests
 *  that carry none share one bucket, which is the conservative answer. */
export const mcpCallerAddress = (request: Request): string => {
	const headers = request.headers;
	const direct =
		headers.get("cf-connecting-ip") ?? headers.get("x-real-ip") ?? null;
	if (direct?.trim()) return direct.trim();
	const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	return forwarded || "unknown";
};

/**
 * Count one request against its address, before anything is resolved, and say
 * whether it may proceed. Refuses once the address has spent either budget.
 */
export const admitMcpCaller = (
	address: string,
): { ok: true } | { ok: false; retryAfterSeconds: number } => {
	const now = Date.now();
	const bucket = addressBucketFor(address, now);
	bucket.requests += 1;
	const over =
		bucket.requests > MAX_REQUESTS_PER_ADDRESS ||
		bucket.authFailures >= MAX_AUTH_FAILURES_PER_ADDRESS;
	return over
		? { ok: false, retryAfterSeconds: retryAfter(bucket, now) }
		: { ok: true };
};

/** Record that a request from this address presented no usable credential. */
export const recordMcpAuthFailure = (address: string): void => {
	addressBucketFor(address, Date.now()).authFailures += 1;
};

/** Drop every counter. Tests only — nothing in the app resets a window. */
export const resetMcpRateLimits = () => {
	buckets.clear();
	addressBuckets.clear();
};
