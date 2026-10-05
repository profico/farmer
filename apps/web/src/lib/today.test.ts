import { describe, expect, test } from "bun:test";

import { type TodayEnv, watchToday } from "./today.ts";

/** A clock and a timer list that the test moves by hand. */
function fakeEnv(startIso: string) {
	let nowMs = Date.parse(startIso);
	let nextId = 1;
	const timers = new Map<number, { at: number; run: () => void }>();
	const wake = new Set<() => void>();

	const env: TodayEnv = {
		now: () => new Date(nowMs),
		setTimer: (run, ms) => {
			const id = nextId++;
			timers.set(id, { at: nowMs + ms, run });
			return id;
		},
		clearTimer: (handle) => {
			timers.delete(handle);
		},
		onWake: (run) => {
			wake.add(run);
			return () => wake.delete(run);
		},
	};

	return {
		env,
		/** Moves the clock and runs every timer that is due, as a browser does. */
		advanceTo(iso: string) {
			nowMs = Date.parse(iso);
			for (const [id, timer] of [...timers]) {
				if (timer.at > nowMs) continue;
				timers.delete(id);
				timer.run();
			}
		},
		/** Moves the clock only: a sleeping laptop runs no timer. */
		sleepUntil(iso: string) {
			nowMs = Date.parse(iso);
		},
		wakeUp() {
			for (const run of [...wake]) run();
		},
		pendingTimers: () => timers.size,
		wakeListeners: () => wake.size,
		nextDelay: () => {
			const [timer] = [...timers.values()];
			return timer ? timer.at - nowMs : null;
		},
	};
}

describe("watchToday", () => {
	test("reports the change at midnight in the zone, not in UTC", () => {
		const world = fakeEnv("2026-10-03T21:30:00Z");
		let calls = 0;
		watchToday("Europe/Zagreb", () => calls++, world.env);

		// 21:59 UTC is 23:59 in Zagreb: still 3 October.
		world.advanceTo("2026-10-03T21:59:59Z");
		expect(calls).toBe(0);
		// 22:00 UTC is midnight in Zagreb.
		world.advanceTo("2026-10-03T22:00:00Z");
		expect(calls).toBe(1);
	});

	test("does not report midnight UTC for a zone behind UTC", () => {
		const world = fakeEnv("2026-10-03T23:00:00Z");
		let calls = 0;
		watchToday("America/Los_Angeles", () => calls++, world.env);
		world.advanceTo("2026-10-04T00:00:00Z");
		expect(calls).toBe(0);
		// Midnight in Los Angeles (UTC-7) is 07:00 UTC.
		world.advanceTo("2026-10-04T07:00:00Z");
		expect(calls).toBe(1);
	});

	test("keeps reporting on each following day", () => {
		const world = fakeEnv("2026-12-30T12:00:00Z");
		let calls = 0;
		watchToday("UTC", () => calls++, world.env);
		world.advanceTo("2026-12-31T00:00:00Z");
		world.advanceTo("2027-01-01T00:00:00Z");
		world.advanceTo("2027-01-02T00:00:00Z");
		expect(calls).toBe(3);
		expect(world.pendingTimers()).toBe(1);
	});

	test("waits 25 hours on the day the clocks go back", () => {
		const world = fakeEnv("2026-10-24T22:00:00Z");
		watchToday("Europe/Zagreb", () => {}, world.env);
		expect(world.nextDelay()).toBe(25 * 3_600_000);
	});

	test("waits 23 hours on the day the clocks go forward", () => {
		const world = fakeEnv("2026-03-28T23:00:00Z");
		watchToday("Europe/Zagreb", () => {}, world.env);
		expect(world.nextDelay()).toBe(23 * 3_600_000);
	});

	test("reports a day that passed while the machine slept", () => {
		const world = fakeEnv("2026-09-15T10:00:00Z");
		let calls = 0;
		watchToday("Europe/Zagreb", () => calls++, world.env);

		// Six days pass with no timer run, as with a closed laptop lid.
		world.sleepUntil("2026-09-21T08:00:00Z");
		expect(calls).toBe(0);
		world.wakeUp();
		expect(calls).toBe(1);
		// The timer is set again for the next midnight, not left in the past.
		expect(world.pendingTimers()).toBe(1);
		expect(world.nextDelay()).toBeGreaterThan(0);
	});

	test("says nothing when the page wakes on the same day", () => {
		const world = fakeEnv("2026-09-15T10:00:00Z");
		let calls = 0;
		watchToday("Europe/Zagreb", () => calls++, world.env);
		world.sleepUntil("2026-09-15T12:00:00Z");
		world.wakeUp();
		expect(calls).toBe(0);
	});

	test("the undo removes the timer and the wake listener", () => {
		const world = fakeEnv("2026-09-15T10:00:00Z");
		let calls = 0;
		const stop = watchToday("UTC", () => calls++, world.env);
		expect(world.pendingTimers()).toBe(1);
		expect(world.wakeListeners()).toBe(1);
		stop();
		expect(world.pendingTimers()).toBe(0);
		expect(world.wakeListeners()).toBe(0);
		world.advanceTo("2026-09-17T00:00:00Z");
		expect(calls).toBe(0);
	});
});
