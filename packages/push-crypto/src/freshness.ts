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
 * The device refuses a payload that is older than `PUSH_MAX_AGE_MS`, that is
 * more than `PUSH_MAX_SKEW_MS` in the future, or whose id it saw already.
 * The device keeps an id for as long as its payload can pass the age check.
 * Thus a party that kept an old sealed value (the relay,
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

/** A payload that the server sent later than this after the device's clock
 *  is refused. It allows for a device clock that is a little slow. */
export const PUSH_MAX_SKEW_MS = 30 * 60 * 1000;

/** The device keeps at most this many accepted ids. */
export const PUSH_SEEN_LIMIT = 500;

/** Random bytes of an id: 12 base64url characters. */
export const PUSH_ID_BYTES = 9;

/** The fields that the server adds to each sealed payload. */
export type PushEnvelope = {
	pushKind: PushKind;
	sentAt: number;
	id: string;
};

export type FreshnessVerdict =
	| "ok"
	| "wrong_kind"
	| "stale"
	| "future"
	| "replayed";

/** One accepted push: its id, and its `sentAt`. The device keeps the id
 *  until the payload is too old to pass the age check anyway. */
export type SeenPush = { id: string; at: number };

/**
 * The ids that the device accepted. `floor` is the newest `sentAt` that the
 * device forgot because the list was full. The device refuses each payload
 * that is not newer than `floor`, so a forgotten id cannot pass again.
 */
export type PushSeen = { floor: number; entries: SeenPush[] };

export const emptyPushSeen = (): PushSeen => ({ floor: 0, entries: [] });

/**
 * Whether a device accepts a payload. `received` is the kind of the push that
 * brought it, or null when the push did not say. `seen` holds the ids that
 * the device accepted before.
 */
export const checkFreshness = (
	envelope: PushEnvelope,
	received: string | null,
	nowMs: number,
	seen: PushSeen,
): FreshnessVerdict => {
	if (received === null || envelope.pushKind !== received) {
		return "wrong_kind";
	}
	if (envelope.sentAt - nowMs > PUSH_MAX_SKEW_MS) return "future";
	if (nowMs - envelope.sentAt > PUSH_MAX_AGE_MS) return "stale";
	if (envelope.sentAt <= seen.floor) return "stale";
	if (seen.entries.some((entry) => entry.id === envelope.id)) {
		return "replayed";
	}
	return "ok";
};

/**
 * The seen list after the device accepted `envelope`. An entry leaves the
 * list when its payload is too old to pass `checkFreshness`. If the list is
 * still longer than `PUSH_SEEN_LIMIT`, the entries with the oldest `sentAt`
 * leave it and `floor` moves up to the newest of them. The device does not
 * refuse a new push for a full list: the maximum age of a payload becomes
 * shorter instead, and a forgotten id still fails the `floor` check.
 */
export const rememberPushId = (
	seen: PushSeen,
	envelope: PushEnvelope,
	nowMs: number,
): PushSeen => {
	const kept = seen.entries.filter(
		(entry) => entry.id !== envelope.id && nowMs - entry.at <= PUSH_MAX_AGE_MS,
	);
	kept.push({ id: envelope.id, at: envelope.sentAt });
	kept.sort((a, b) => a.at - b.at);
	const dropped = kept.splice(0, Math.max(0, kept.length - PUSH_SEEN_LIMIT));
	const floor = dropped.reduce(
		(top, entry) => Math.max(top, entry.at),
		seen.floor,
	);
	return { floor, entries: kept };
};
