/**
 * Fixed-window counters in memory. The relay runs as one process, so a map is
 * enough; a restart forgives every caller, and that is acceptable for a push.
 */

export type Admission = { ok: true } | { ok: false; retryAfterSeconds: number };

type Bucket = { windowStartedAt: number; count: number };

/** The most keys one limiter tracks. Past it the least recently counted
 *  bucket goes first, which at worst forgives one key early. Without a cap,
 *  a caller who varies a key could grow the map without end. */
const DEFAULT_MAX_KEYS = 50_000;

export class FixedWindowLimiter {
	readonly #limit: number;
	readonly #windowMs: number;
	readonly #maxKeys: number;
	/** Map order is the order of the last count: the first key is the one
	 *  that was counted longest ago. */
	readonly #buckets = new Map<string, Bucket>();
	#nextSweepAt = 0;

	constructor(limit: number, windowMs: number, maxKeys = DEFAULT_MAX_KEYS) {
		this.#limit = limit;
		this.#windowMs = windowMs;
		this.#maxKeys = maxKeys;
	}

	get size(): number {
		return this.#buckets.size;
	}

	#expired(bucket: Bucket, now: number): boolean {
		return now - bucket.windowStartedAt >= this.#windowMs;
	}

	/** Drop every expired bucket. It runs at most one time for each window,
	 *  so the cost for each request stays constant on average. */
	#sweep(now: number): void {
		if (now < this.#nextSweepAt) return;
		this.#nextSweepAt = now + this.#windowMs;
		for (const [key, bucket] of this.#buckets) {
			if (this.#expired(bucket, now)) this.#buckets.delete(key);
		}
	}

	/** Make room for one new key. Remove the oldest bucket. */
	#evict(): void {
		const oldest = this.#buckets.keys().next();
		if (!oldest.done) this.#buckets.delete(oldest.value);
	}

	/** Whether one more request fits, without a count. It never adds a
	 *  bucket, so a caller that varies a key cannot grow the map. */
	check(key: string, now: number): Admission {
		const bucket = this.#buckets.get(key);
		if (!bucket || this.#expired(bucket, now) || bucket.count < this.#limit) {
			return { ok: true };
		}
		const resetsAt = bucket.windowStartedAt + this.#windowMs;
		return {
			ok: false,
			retryAfterSeconds: Math.max(1, Math.ceil((resetsAt - now) / 1000)),
		};
	}

	/** Count one request. */
	record(key: string, now: number): void {
		this.#sweep(now);
		const existing = this.#buckets.get(key);
		const live = existing && !this.#expired(existing, now) ? existing : null;
		if (!live && !existing && this.#buckets.size >= this.#maxKeys) {
			this.#evict();
		}
		const bucket = live ?? { windowStartedAt: now, count: 0 };
		bucket.count += 1;
		// Move the key to the end, so a busy key outlives a flood of new keys.
		this.#buckets.delete(key);
		this.#buckets.set(key, bucket);
	}
}

/**
 * Admit a request against several limiters at one time. It counts against
 * all of them only when all of them have room, so a refusal by the daily
 * limit does not also spend the minute's budget.
 */
export const admit = (
	checks: ReadonlyArray<readonly [FixedWindowLimiter, string]>,
	now: number,
): Admission => {
	let longest: Admission = { ok: true };
	for (const [limiter, key] of checks) {
		const result = limiter.check(key, now);
		if (
			!result.ok &&
			(longest.ok || result.retryAfterSeconds > longest.retryAfterSeconds)
		) {
			longest = result;
		}
	}
	if (!longest.ok) return longest;
	for (const [limiter, key] of checks) limiter.record(key, now);
	return longest;
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** The numbers behind every limit. A test passes smaller ones. */
export type RelayLimits = {
	/** Alert and data pushes for one relay id. */
	pushPerMinute: number;
	pushPerDay: number;
	/** Live Activity pushes for one relay id. A running timer changes more
	 *  often than a person gets a notification, so this budget is larger. */
	liveActivityPerMinute: number;
	liveActivityPerDay: number;
	/** Pushes from one address. One farmer server is one address for all of
	 *  its users, and a reminder goes to many of them at the same minute, so
	 *  this is high. The per-device limits above stop abuse of one device. */
	pushPerAddressPerMinute: number;
	/** Registrations, token updates and removals from one address. */
	devicePerAddressPer10Minutes: number;
	/** Binding checks from one address. One farmer server is one address
	 *  for all of its users, so this is high. */
	verifyPerAddressPerMinute: number;
	/** Binding checks for one relay id. This stops a guess of a proof. */
	verifyPerRelayPer10Minutes: number;
};

export const DEFAULT_LIMITS: RelayLimits = {
	pushPerMinute: 30,
	pushPerDay: 500,
	liveActivityPerMinute: 60,
	liveActivityPerDay: 2_000,
	pushPerAddressPerMinute: 6_000,
	devicePerAddressPer10Minutes: 60,
	verifyPerAddressPerMinute: 6_000,
	verifyPerRelayPer10Minutes: 10,
};

export type RelayLimiters = {
	push: { minute: FixedWindowLimiter; day: FixedWindowLimiter };
	liveActivity: { minute: FixedWindowLimiter; day: FixedWindowLimiter };
	pushByAddress: FixedWindowLimiter;
	deviceByAddress: FixedWindowLimiter;
	verifyByAddress: FixedWindowLimiter;
	verifyByRelayId: FixedWindowLimiter;
};

export const createLimiters = (limits: RelayLimits): RelayLimiters => ({
	push: {
		minute: new FixedWindowLimiter(limits.pushPerMinute, MINUTE),
		day: new FixedWindowLimiter(limits.pushPerDay, DAY),
	},
	liveActivity: {
		minute: new FixedWindowLimiter(limits.liveActivityPerMinute, MINUTE),
		day: new FixedWindowLimiter(limits.liveActivityPerDay, DAY),
	},
	pushByAddress: new FixedWindowLimiter(limits.pushPerAddressPerMinute, MINUTE),
	deviceByAddress: new FixedWindowLimiter(
		limits.devicePerAddressPer10Minutes,
		10 * MINUTE,
	),
	verifyByAddress: new FixedWindowLimiter(
		limits.verifyPerAddressPerMinute,
		MINUTE,
	),
	verifyByRelayId: new FixedWindowLimiter(
		limits.verifyPerRelayPer10Minutes,
		10 * MINUTE,
	),
});
