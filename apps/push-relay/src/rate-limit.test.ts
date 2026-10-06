import { describe, expect, test } from "bun:test";

import { admit, FixedWindowLimiter } from "./rate-limit";

const WINDOW = 60_000;

describe("FixedWindowLimiter", () => {
	test("check() on many unique keys does not add a bucket", () => {
		const limiter = new FixedWindowLimiter(2, WINDOW, 10);
		for (let i = 0; i < 1_000; i += 1) {
			expect(limiter.check(`key-${i}`, 0)).toEqual({ ok: true });
		}
		expect(limiter.size).toBe(0);
	});

	test("a hot key survives a flood of new keys", () => {
		const limiter = new FixedWindowLimiter(3, WINDOW, 10);
		for (let i = 0; i < 500; i += 1) {
			limiter.record(`flood-${i}`, i);
			if (i % 5 === 0) limiter.record("hot", i);
		}
		expect(limiter.size).toBeLessThanOrEqual(10);
		// The hot key kept its count: it is over the limit of 3.
		const refused = limiter.check("hot", 500);
		expect(refused.ok).toBe(false);
	});

	test("a request over the limit gets a retry time", () => {
		const limiter = new FixedWindowLimiter(1, WINDOW);
		limiter.record("a", 0);
		expect(limiter.check("a", 30_000)).toEqual({
			ok: false,
			retryAfterSeconds: 30,
		});
		expect(limiter.check("a", WINDOW)).toEqual({ ok: true });
	});

	test("an expired bucket is swept without a new key at the cap", () => {
		const limiter = new FixedWindowLimiter(1, WINDOW, 1_000);
		for (let i = 0; i < 100; i += 1) limiter.record(`k-${i}`, 0);
		limiter.record("later", WINDOW + 1);
		expect(limiter.size).toBe(1);
	});

	test("admit() counts only when every limiter has room", () => {
		const minute = new FixedWindowLimiter(5, WINDOW);
		const day = new FixedWindowLimiter(1, WINDOW * 60);
		expect(
			admit(
				[
					[minute, "a"],
					[day, "a"],
				],
				0,
			).ok,
		).toBe(true);
		expect(
			admit(
				[
					[minute, "a"],
					[day, "a"],
				],
				1,
			).ok,
		).toBe(false);
		minute.record("b", 2);
		expect(minute.check("a", 2).ok).toBe(true);
	});
});
