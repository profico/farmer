/**
 * Fixed-window counters in memory. The relay runs as one process, so a map is
 * enough; a restart forgives every caller, and that is acceptable for a push.
 */

export type Admission = { ok: true } | { ok: false; retryAfterSeconds: number };

type Bucket = { windowStartedAt: number; count: number };

/** The most keys one limiter tracks. Past it the oldest window goes first,
 *  which at worst forgives one key early. Without a cap, a caller who varies
 *  a key could grow the map without end. */
const DEFAULT_MAX_KEYS = 50_000;

export class FixedWindowLimiter {
	readonly #limit: number;
	readonly #windowMs: number;
	readonly #maxKeys: number;
	readonly #buckets = new Map<string, Bucket>();

	constructor(limit: number, windowMs: number, maxKeys = DEFAULT_MAX_KEYS) {
		this.#limit = limit;
		this.#windowMs = windowMs;
		this.#maxKeys = maxKeys;
	}

	get size(): number {
		return this.#buckets.size;
	}

	#bucket(key: string, now: number): Bucket {
		const existing = this.#buckets.get(key);
		if (existing && now - existing.windowStartedAt < this.#windowMs) {
			return existing;
		}
		if (this.#buckets.size >= this.#maxKeys) {
			for (const [old, bucket] of this.#buckets) {
				if (now - bucket.windowStartedAt >= this.#windowMs) {
					this.#buckets.delete(old);
				}
			}
		}
		// Map iteration is insertion order, so the first key is the oldest.
		while (this.#buckets.size >= this.#maxKeys) {
			const oldest = this.#buckets.keys().next();
			if (oldest.done) break;
			this.#buckets.delete(oldest.value);
		}
		const fresh = { windowStartedAt: now, count: 0 };
		this.#buckets.delete(key);
		this.#buckets.set(key, fresh);
		return fresh;
	}

	/** Whether one more request fits, without a count. */
	check(key: string, now: number): Admission {
		const bucket = this.#bucket(key, now);
		if (bucket.count < this.#limit) return { ok: true };
		const resetsAt = bucket.windowStartedAt + this.#windowMs;
		return {
			ok: false,
			retryAfterSeconds: Math.max(1, Math.ceil((resetsAt - now) / 1000)),
		};
	}

	/** Count one request. */
	record(key: string, now: number): void {
		this.#bucket(key, now).count += 1;
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
};

export const DEFAULT_LIMITS: RelayLimits = {
	pushPerMinute: 30,
	pushPerDay: 500,
	liveActivityPerMinute: 60,
	liveActivityPerDay: 2_000,
	pushPerAddressPerMinute: 6_000,
	devicePerAddressPer10Minutes: 60,
};

export type RelayLimiters = {
	push: { minute: FixedWindowLimiter; day: FixedWindowLimiter };
	liveActivity: { minute: FixedWindowLimiter; day: FixedWindowLimiter };
	pushByAddress: FixedWindowLimiter;
	deviceByAddress: FixedWindowLimiter;
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
});
