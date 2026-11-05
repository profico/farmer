import type { RelayPlatform, RelayUpdate } from "./relay";

/**
 * What the app sends to the relay to bind a Live Activity token
 * (`apps/push-relay/README.md`, "Live Activity tokens").
 *
 * `wanted` is the token that the app learned last: a string for a running
 * activity, null after the last activity ended, undefined when the app has
 * learned nothing yet. `bound` is the token that the relay confirmed.
 * Returns null when the app has nothing to send. Only iOS has Live
 * Activities, so Android never sends this.
 *
 * `force` binds a running activity's token again, even when `bound` already
 * holds it. The relay can lose a binding that the app still remembers, and
 * the relay bind is idempotent. `force` does nothing for a null `wanted`.
 */
export const activityBinding = (
	platform: RelayPlatform,
	wanted: string | null | undefined,
	bound: string | null | undefined,
	force = false,
): RelayUpdate | null => {
	if (platform !== "ios" || wanted === undefined) return null;
	if (wanted === (bound ?? null) && !(force && wanted !== null)) return null;
	return { liveActivityToken: wanted };
};
