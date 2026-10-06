/**
 * The freshness of a sealed push: what the server puts in each plaintext and
 * what the device checks before it acts on it.
 *
 * The server adds three fields to the sealed JSON:
 *
 *  - `pushKind`: the `kind` of the relay request ("alert", "data" or
 *    "liveactivity"). The relay sees the outer kind but cannot change the
 *    sealed one, so the device refuses a sealed value that came in a push of
 *    a different kind.
 *  - `sentAt`: Unix milliseconds on the server's clock.
 *  - `id`: a short random value, different for each push.
 *
 * The device refuses a payload that is older than `PUSH_MAX_AGE_MS` or whose
 * id it saw already. Thus a party that kept an old sealed value (the relay,
 * or a party on its path) cannot send it to the device again later.
 *
 * No dependencies and no random source: the app imports this file under
 * Hermes, as it imports `./device`. The server makes the id.
 */

/** The relay's kinds of push. */
export const PUSH_KINDS = ["alert", "data", "liveactivity"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/** A payload older than this is refused. */
export const PUSH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The device keeps this many of the last ids that it accepted. */
export const PUSH_SEEN_LIMIT = 50;

/** Random bytes of an id: 12 base64url characters. */
export const PUSH_ID_BYTES = 9;

/** The fields that the server adds to each sealed payload. */
export type PushEnvelope = {
	pushKind: PushKind;
	sentAt: number;
	id: string;
};

export type FreshnessVerdict = "ok" | "wrong_kind" | "stale" | "replayed";

/**
 * Whether a device accepts a payload. `received` is the kind of the push that
 * brought it, or null when the push did not say. `seen` is the list of ids
 * that the device accepted before.
 */
export const checkFreshness = (
	envelope: PushEnvelope,
	received: string | null,
	nowMs: number,
	seen: readonly string[],
): FreshnessVerdict => {
	if (received === null || envelope.pushKind !== received) {
		return "wrong_kind";
	}
	if (nowMs - envelope.sentAt > PUSH_MAX_AGE_MS) return "stale";
	if (seen.includes(envelope.id)) return "replayed";
	return "ok";
};

/** The seen list after the device accepted `id`: the newest last, at most
 *  `PUSH_SEEN_LIMIT` long. */
export const rememberPushId = (seen: readonly string[], id: string): string[] =>
	[...seen.filter((item) => item !== id), id].slice(-PUSH_SEEN_LIMIT);
