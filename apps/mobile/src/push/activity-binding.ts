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
 */
export const activityBinding = (
	platform: RelayPlatform,
	wanted: string | null | undefined,
	bound: string | null | undefined,
): RelayUpdate | null => {
	if (platform !== "ios" || wanted === undefined) return null;
	if (wanted === (bound ?? null)) return null;
	return { liveActivityToken: wanted };
};
