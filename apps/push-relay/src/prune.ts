import type { Log } from "./delivery/types";
import type { DeviceStore } from "./store";

/** A device that the relay has not seen for this long is pruned. The app
 *  registers again when its relay id is unknown (see README.md). */
export const STALE_DEVICE_MS = 180 * 24 * 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

/** Delete the devices unseen for `STALE_DEVICE_MS`, and log the count. */
export const pruneStaleDevices = (
	store: DeviceStore,
	now: number,
	log: Log,
): number => {
	const pruned = store.pruneUnseenSince(now - STALE_DEVICE_MS);
	if (pruned > 0) log(`[push-relay] pruned ${pruned} stale devices`);
	return pruned;
};

/** Prune one time now and then each day, in this process. Returns a
 *  function that stops the timer. */
export const startPruning = (
	store: DeviceStore,
	now: () => number,
	log: Log,
): (() => void) => {
	pruneStaleDevices(store, now(), log);
	const timer = setInterval(() => pruneStaleDevices(store, now(), log), DAY_MS);
	// The timer must not keep the process alive at shutdown.
	timer.unref();
	return () => clearInterval(timer);
};
