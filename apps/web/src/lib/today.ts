import { dayKeyInTz, msUntilNextDay } from "@farmer/core/lib/time";

// What "today" is, kept true while a page stays open.
//
// A screen that reads `dayKeyInTz(new Date(), tz)` while it renders knows the
// day only as of that render. A tab can stay open for days, and two parts of
// one screen can then render at different times and disagree about the day.
// `watchToday` tells a screen when the day changes, so the screen can read the
// clock again.

/** The parts of the outside world that `watchToday` needs. A test replaces them. */
export type TodayEnv = {
	now: () => Date;
	setTimer: (run: () => void, ms: number) => number;
	clearTimer: (handle: number) => void;
	/** Calls `run` when the page comes back to the person. Returns the undo. */
	onWake: (run: () => void) => () => void;
};

const browserEnv: TodayEnv = {
	now: () => new Date(),
	setTimer: (run, ms) => window.setTimeout(run, ms),
	clearTimer: (handle) => window.clearTimeout(handle),
	onWake: (run) => {
		const onVisible = () => {
			if (document.visibilityState === "visible") run();
		};
		document.addEventListener("visibilitychange", onVisible);
		window.addEventListener("focus", run);
		return () => {
			document.removeEventListener("visibilitychange", onVisible);
			window.removeEventListener("focus", run);
		};
	},
};

/**
 * Calls `onChange` when the day in `timezone` is no longer the day it was.
 *
 * The timer is set for the next midnight of that zone. A timer does not run
 * while a laptop sleeps, and a hidden tab can run it late. So the page also
 * checks the day when it comes back to the person. Returns the undo.
 */
export function watchToday(
	timezone: string,
	onChange: () => void,
	env: TodayEnv = browserEnv,
): () => void {
	let seen = dayKeyInTz(env.now(), timezone);
	let handle: number | undefined;

	const check = () => {
		const current = dayKeyInTz(env.now(), timezone);
		if (current !== seen) {
			seen = current;
			onChange();
		}
	};
	const schedule = () => {
		if (handle !== undefined) env.clearTimer(handle);
		const wait = msUntilNextDay(env.now(), timezone);
		handle = env.setTimer(() => {
			check();
			schedule();
		}, wait);
	};

	const stopWake = env.onWake(() => {
		check();
		schedule();
	});
	schedule();

	return () => {
		stopWake();
		if (handle !== undefined) env.clearTimer(handle);
	};
}
