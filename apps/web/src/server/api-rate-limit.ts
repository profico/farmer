/**
 * Per-user and per-address ceilings on the token-authenticated surfaces, held
 * in memory. One set of buckets per surface: the MCP server and the CLI's REST
 * API.
 *
 * The thing on the other end of either connection may be a loop, not a person.
 * A UI makes a request when somebody clicks; an agent makes one whenever it
 * decides to, and a shell script around the CLI makes one every time `watch`
 * ticks. Two ceilings rather than one, because the two failure modes cost
 * different things: a thousand reads a minute is load, and a thousand WRITES a
 * minute is a timesheet nobody can reconstruct — and reads are the ones a
 * legitimate session makes many of.
 *
 * Separate buckets per surface, with the same numbers today. A person who has
 * Claude Code and a terminal open at once is two clients, and one of them
 * spending its budget must not refuse the other. The numbers can then drift
 * apart per surface without a second module.
 *
 * In memory, and so per process, which is the right shape here rather than a
 * concession: `startSchedulers` already assumes a single instance (see
 * the table in `docs/domains/deployment.md`), so there is no second web process for a
 * counter to disagree with. A deployment that grows one needs a shared store
 * for this and a lock for the jobs, in that order.
 *
 * A fixed window, not a sliding one. It admits a burst across a boundary — up
 * to twice the limit in a moment — and that is fine for a ceiling whose job is
 * to stop a runaway loop rather than to shape traffic.
 */

import { clientAddress, trustedIpHeader } from "#/lib/client-address.ts";

/** The surfaces that keep their own buckets. */
export type RateLimitSurface = "mcp" | "cli";

export type Admission = { ok: true } | { ok: false; retryAfterSeconds: number };

const WINDOW_MS = 60_000;

/** Requests per user per minute. Generous: one `tools/list` plus a step's worth
 *  of calls is a handful, and so is `farmer week`, so this bites a loop and not
 *  a session. */
const MAX_REQUESTS = 300;

/** Writes per user per minute: an MCP tool call that is not `read`, or a CLI
 *  request with a method other than GET. */
const MAX_WRITES = 30;

/** Past this many tracked keys, drop the expired buckets on the way in. A map
 *  is keyed by user id or address and a bucket is never removed when its window
 *  ends, so without this a long-lived process keeps a row per caller who ever
 *  connected. */
const SWEEP_AT = 1_000;

type Bucket = { windowStartedAt: number; requests: number; writes: number };

const userBuckets = {
	mcp: new Map<string, Bucket>(),
	cli: new Map<string, Bucket>(),
} satisfies Record<RateLimitSurface, Map<string, Bucket>>;

const bucketFor = (
	surface: RateLimitSurface,
	userId: string,
	now: number,
): Bucket => {
	const buckets = userBuckets[surface];
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

/** Seconds until this window rolls over — the `Retry-After` value. */
const retryAfter = (bucket: { windowStartedAt: number }, now: number) =>
	Math.max(1, Math.ceil((bucket.windowStartedAt + WINDOW_MS - now) / 1000));

/**
 * Count one HTTP request against the user, and say whether it may proceed.
 *
 * Returns the retry delay rather than a bare boolean, so the caller can answer
 * with a `Retry-After` a client can actually wait on instead of one it has to
 * guess.
 */
export const admitRequest = (
	surface: RateLimitSurface,
	userId: string,
): Admission => {
	const now = Date.now();
	const bucket = bucketFor(surface, userId, now);
	bucket.requests += 1;
	return bucket.requests > MAX_REQUESTS
		? { ok: false, retryAfterSeconds: retryAfter(bucket, now) }
		: { ok: true };
};

/**
 * Count one write against the user, and say whether it may run.
 *
 * Separate from `admitRequest` because a single MCP request may carry several
 * tool calls, and because the two ceilings are about different harms.
 */
export const admitWrite = (
	surface: RateLimitSurface,
	userId: string,
): Admission => {
	const now = Date.now();
	const bucket = bucketFor(surface, userId, now);
	bucket.writes += 1;
	return bucket.writes > MAX_WRITES
		? { ok: false, retryAfterSeconds: retryAfter(bucket, now) }
		: { ok: true };
};

// ── Per caller address, BEFORE the credential is resolved ────────────────────
//
// The per-user ceilings above need a user id, and a user id costs a session
// lookup or a token lookup — database reads. So they only ever limited people
// who had already authenticated: a caller with no credential, or a garbage
// one, cost queries on every request with nothing counting them. These two run
// first, keyed on the address the request came from, and need no I/O at all.
//
// Two counters, because the two things they catch look different:
//  * a flood — any request at all, with a ceiling well above one user's 300 so
//    an office of agents behind one NAT address is not what it bites;
//  * guessing — requests whose credential resolved to nobody. A real client
//    fails exactly once (the 401 that starts its OAuth flow, or that tells the
//    CLI to run `farmer login`), so a small budget here costs a legitimate
//    caller nothing.
//
// The address comes from the one header `TRUSTED_IP_HEADER` names, or from the
// socket (`callerAddress` below). A deployment whose proxy does not overwrite
// that header lets a caller choose its own key; that weakens this to a
// per-claimed-address limit, and the hard cap on the map below is what keeps it
// from also becoming a memory leak.

/** Requests per caller address per minute, authenticated or not. */
const MAX_REQUESTS_PER_ADDRESS = 1_200;

/** Requests per caller address per minute whose credential resolved to no one. */
const MAX_AUTH_FAILURES_PER_ADDRESS = 30;

/** The most addresses tracked at once, per surface. Past it the oldest bucket
 *  is dropped, which at worst forgives one address early — the alternative is
 *  a map an attacker grows by varying a header. */
const MAX_TRACKED_ADDRESSES = 10_000;

type AddressBucket = {
	windowStartedAt: number;
	requests: number;
	authFailures: number;
};

const addressBuckets = {
	mcp: new Map<string, AddressBucket>(),
	cli: new Map<string, AddressBucket>(),
} satisfies Record<RateLimitSurface, Map<string, AddressBucket>>;

const addressBucketFor = (
	surface: RateLimitSurface,
	address: string,
	now: number,
): AddressBucket => {
	const buckets = addressBuckets[surface];
	const existing = buckets.get(address);
	if (existing && now - existing.windowStartedAt < WINDOW_MS) return existing;
	if (buckets.size >= SWEEP_AT) {
		for (const [key, bucket] of buckets) {
			if (now - bucket.windowStartedAt >= WINDOW_MS) buckets.delete(key);
		}
	}
	// Map iteration is insertion order, so the first key is the oldest window.
	while (buckets.size >= MAX_TRACKED_ADDRESSES) {
		const oldest = buckets.keys().next();
		if (oldest.done) break;
		buckets.delete(oldest.value);
	}
	const fresh = { windowStartedAt: now, requests: 0, authFailures: 0 };
	// Delete first so a renewed window moves to the back of the eviction order.
	buckets.delete(address);
	buckets.set(address, fresh);
	return fresh;
};

/** The address a request came from: the one header `TRUSTED_IP_HEADER` names
 *  (default `cf-connecting-ip`), else the socket address the production host
 *  recorded, else `"unknown"`, one shared bucket. See `lib/client-address.ts`.
 *  The variable is read per call, because this module also ships to the
 *  browser, where `process.env` is not there to read at import. */
export const callerAddress = (request: Request): string =>
	clientAddress(
		request.headers,
		trustedIpHeader(process.env.TRUSTED_IP_HEADER),
	);

/**
 * Count one request against its address, before anything is resolved, and say
 * whether it may proceed. Refuses once the address has spent either budget.
 */
export const admitCaller = (
	surface: RateLimitSurface,
	address: string,
): Admission => {
	const now = Date.now();
	const bucket = addressBucketFor(surface, address, now);
	bucket.requests += 1;
	const over =
		bucket.requests > MAX_REQUESTS_PER_ADDRESS ||
		bucket.authFailures >= MAX_AUTH_FAILURES_PER_ADDRESS;
	return over
		? { ok: false, retryAfterSeconds: retryAfter(bucket, now) }
		: { ok: true };
};

/** Record that a request from this address presented no usable credential. */
export const recordAuthFailure = (
	surface: RateLimitSurface,
	address: string,
): void => {
	addressBucketFor(surface, address, Date.now()).authFailures += 1;
};

/** Drop every counter on every surface. Tests only — nothing in the app resets
 *  a window. */
export const resetRateLimits = () => {
	for (const surface of ["mcp", "cli"] as const) {
		userBuckets[surface].clear();
		addressBuckets[surface].clear();
	}
};
