// The native push TRANSPORT: from this server, through the push relay, to the
// person's phones (ADR 0006, `docs/domains/mobile.md`).
//
// Two kinds of message go out here:
//
//  * An alert, for `notify`'s "native" channel. `notify` decides who may hear
//    what; this module only knows phones. It is the sibling of
//    `notificationsService.sendPush`, and like it, it is not a call site.
//  * A timer change, for the Live Activity on iOS and the ongoing
//    notification on Android. `timersService` and `jobs/timer-sweep.ts` call
//    `publishTimerChange` after the write, and never wait for it.
//
// Nothing goes out while `PUSH_RELAY_ENABLED` is off, and nothing is read
// either: the check comes before the first query.
//
// Each payload is sealed for one phone with `@farmer/push-crypto`. The relay
// sees only the relay id, the kind and, for a Live Activity, the content state
// that iOS reads directly. The content state therefore holds numbers and the
// workspace slug, and never a project, a task or a note.

import {
	fromBase64Url,
	PUSH_INFO,
	pushEnvelope,
	type PushKind,
	sealForDevice,
	toBase64Url,
} from "@farmer/push-crypto";
import { and, eq, gt, ne, or } from "drizzle-orm";

import { db } from "../db";
import { member, session } from "../db/schema/auth";
import { mobileDevice } from "../db/schema/mobile";
import {
	type LiveActivityEvent,
	pushRelayUrl,
	type RelayLiveActivity,
	type RelayOutcome,
	type RelayPush,
	sendToRelay,
} from "../lib/push-relay";

/** The largest plaintext that seals within the relay's limit of 3,072
 *  base64url characters: the sealed value is base64url of 65 bytes of `enc`, the plaintext and a 16-byte
 *  tag, so 3,072 characters hold 2,304 bytes, and 2,223 of them are
 *  plaintext. A margin keeps a later change of the envelope safe. */
const MAX_PLAINTEXT_BYTES = 2_100;

/** The Swift type of the timer's `ActivityAttributes`, for a push-to-start. */
const TIMER_ATTRIBUTES_TYPE = "TimerAttributes";

/** The version of the attributes. A change of the content state's shape is a
 *  new number, so the widget can refuse a shape it does not know. */
const TIMER_ACTIVITY_VERSION = 1;

const encoder = new TextEncoder();

/** The person's live phones: rows whose session has not expired. An expired
 *  session stays in the table until better-auth deletes it, and its phone
 *  must not get a push in that time. */
const liveDevices = (userId: string) =>
	db
		.select({
			id: mobileDevice.id,
			platform: mobileDevice.platform,
			relayId: mobileDevice.relayId,
			publicKey: mobileDevice.publicKey,
			liveActivityToken: mobileDevice.liveActivityToken,
			notificationsAllowed: mobileDevice.notificationsAllowed,
		})
		.from(mobileDevice)
		.innerJoin(session, eq(session.id, mobileDevice.sessionId))
		.where(
			and(eq(mobileDevice.userId, userId), gt(session.expiresAt, new Date())),
		);

type Device = Awaited<ReturnType<typeof liveDevices>>[number];

/** The largest freshness fields (`@farmer/push-crypto/freshness`) that
 *  `seal` adds: the longest kind, a 13-digit time and a full id. `fitAlert`
 *  keeps room for them. */
const LARGEST_ENVELOPE = pushEnvelope("liveactivity", 9_999_999_999_999);

/** Seal a payload for one phone, as JSON, with the freshness fields: the
 *  relay kind of the push that carries it, the send time and a new id. The
 *  phone refuses a payload in a push of another kind, an old one, and one
 *  that it saw already. A payload over the relay's limit throws here, so it
 *  fails as one send and never reaches the relay as a 400. */
const seal = async (
	device: Device,
	pushKind: PushKind,
	payload: NativeAlert | SealedTimer,
): Promise<string> => {
	const plaintext = encoder.encode(
		JSON.stringify({ ...payload, ...pushEnvelope(pushKind) }),
	);
	if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
		throw new Error("The push payload is over the relay's limit.");
	}
	return sealForDevice(fromBase64Url(device.publicKey), plaintext, PUSH_INFO);
};

/** What a string adds to a JSON payload, in bytes: its UTF-8 bytes after
 *  `JSON.stringify` escapes it, without the two quotes. A line break costs
 *  two bytes and a control character six. */
const jsonCost = (value: string): number =>
	encoder.encode(JSON.stringify(value)).byteLength - 2;

/** Cut a string so that it adds at most `maxBytes` to a JSON payload, at a
 *  character boundary, with an ellipsis when it was cut. */
const truncateJson = (value: string, maxBytes: number): string => {
	if (jsonCost(value) <= maxBytes) return value;
	const room = Math.max(0, maxBytes - jsonCost("…"));
	let used = 0;
	let out = "";
	for (const char of value) {
		const size = jsonCost(char);
		if (used + size > room) break;
		used += size;
		out += char;
	}
	return `${out}…`;
};

/** Delete one row, by id and relay id: the relay forgot the phone. */
const forget = async (device: Device): Promise<void> => {
	await db
		.delete(mobileDevice)
		.where(
			and(
				eq(mobileDevice.id, device.id),
				eq(mobileDevice.relayId, device.relayId),
			),
		);
};

/** Clear the Live Activity token, only if it is still the one that was
 *  used: the app can have sent a new one in the meantime. */
const clearActivityToken = async (
	device: Device,
	token: string,
): Promise<void> => {
	await db
		.update(mobileDevice)
		.set({ liveActivityToken: null, updatedAt: new Date() })
		.where(
			and(
				eq(mobileDevice.id, device.id),
				eq(mobileDevice.liveActivityToken, token),
			),
		);
};

/** Send one push, and act on the answers that concern the row itself. */
const send = async (
	baseUrl: string,
	device: Device,
	push: RelayPush,
): Promise<RelayOutcome> => {
	const outcome = await sendToRelay(baseUrl, push);
	if (outcome.kind === "device_gone") {
		await forget(device).catch((error: unknown) => {
			// Never log `error` itself. A `DrizzleQueryError` lists the query's
			// parameters, and the relay id in the WHERE clause is the
			// credential for a push. The classes and the driver's code say
			// what went wrong without it.
			const cause = error instanceof Error ? error.cause : undefined;
			console.error("[native-push] could not delete a device", {
				deviceId: device.id,
				error: error instanceof Error ? error.constructor.name : "unknown",
				cause: cause instanceof Error ? cause.constructor.name : undefined,
				code:
					cause instanceof Error && "code" in cause
						? String(cause.code)
						: undefined,
			});
		});
	} else if (outcome.kind === "failed") {
		console.error("[native-push] the relay refused a push", {
			kind: push.kind,
			status: outcome.status,
			code: outcome.code,
		});
	}
	return outcome;
};

// --- Alerts ----------------------------------------------------------------

/** What an alert says. The app shows `title` and `body`, and opens `url` (an
 *  app-relative path) on a tap. */
export type NativeAlert = {
	kind: string;
	title: string;
	body: string;
	url?: string;
};

/** The alert, cut to fit the relay's limit. The body is cut first, because
 *  the title is short and the body is where a long text is (an admin digest
 *  of a large workspace). */
const fitAlert = (alert: NativeAlert): NativeAlert => {
	const title = truncateJson(alert.title, 200);
	const fixed = encoder.encode(
		JSON.stringify({ ...alert, title, body: "", ...LARGEST_ENVELOPE }),
	).byteLength;
	const body = truncateJson(
		alert.body,
		Math.max(0, MAX_PLAINTEXT_BYTES - fixed),
	);
	return { ...alert, title, body };
};

/** A phone that may get an alert now. */
export type NotifiableDevice = Device;

/** The person's phones that may get an alert now: the relay is on and the
 *  rows are live and allow notifications. The list is empty when the relay
 *  is off, and then nothing is read. */
export const notifiableDevices = async (
	userId: string,
): Promise<NotifiableDevice[]> => {
	if (!pushRelayUrl()) return [];
	return (await liveDevices(userId)).filter(
		(device) => device.notificationsAllowed,
	);
};

/** Whether any member of the organization has a live phone that allows
 *  notifications. The relay must be on. The reminder job reads this to decide
 *  if a workspace with no Slack still has someone to remind. */
export const orgHasNotifiablePhone = async (
	organizationId: string,
): Promise<boolean> => {
	if (!pushRelayUrl()) return false;
	const [row] = await db
		.select({ id: mobileDevice.id })
		.from(mobileDevice)
		.innerJoin(session, eq(session.id, mobileDevice.sessionId))
		.innerJoin(member, eq(member.userId, mobileDevice.userId))
		.where(
			and(
				eq(member.organizationId, organizationId),
				eq(mobileDevice.notificationsAllowed, true),
				gt(session.expiresAt, new Date()),
			),
		)
		.limit(1);
	return row !== undefined;
};

/** What the person's phones can do for a reminder: whether the relay is on,
 *  how many live phones the person has, and how many of them allow
 *  notifications. A reminder goes to the app when `allowing` is above 0. */
export type AppReach = { relay: boolean; phones: number; allowing: number };

export const appReach = async (userId: string): Promise<AppReach> => {
	const devices = await liveDevices(userId);
	return {
		relay: pushRelayUrl() !== null,
		phones: devices.length,
		allowing: devices.filter((device) => device.notificationsAllowed).length,
	};
};

/**
 * Send an alert to every phone of the person that allows notifications.
 * Returns true when at least one phone took it, and false otherwise: the
 * relay is off, the person has no such phone, or every push failed. One
 * phone that fails does not change the answer for the others. Never throws.
 *
 * A caller that read the phones with `notifiableDevices` passes them as
 * `devices`, so the table is read one time.
 */
export const sendNativeAlert = async (
	userId: string,
	alert: NativeAlert,
	devices?: NotifiableDevice[],
): Promise<boolean> => {
	const baseUrl = pushRelayUrl();
	if (!baseUrl) return false;
	try {
		const targets = devices ?? (await notifiableDevices(userId));
		const payload = fitAlert(alert);
		const outcomes = await Promise.allSettled(
			targets.map(async (device) =>
				send(baseUrl, device, {
					relayId: device.relayId,
					kind: "alert",
					ciphertext: await seal(device, "alert", payload),
				}),
			),
		);
		for (const outcome of outcomes) {
			if (outcome.status === "rejected") {
				console.error("[native-push] alert failed for a phone", {
					userId,
					error: outcome.reason,
				});
			}
		}
		return outcomes.some(
			(outcome) =>
				outcome.status === "fulfilled" && outcome.value.kind === "delivered",
		);
	} catch (error) {
		console.error("[native-push] alert failed", { userId, error });
		return false;
	}
};

// --- The timer ---------------------------------------------------------------

/** What the timer looks like now, for the phone. */
export type TimerSnapshot = {
	state: "running" | "held";
	/** Unix milliseconds of the start of the running segment, or null while
	 *  held. Never a Swift `Date`: ActivityKit reads a `Date` as seconds since
	 *  2001. */
	runningSinceMs: number | null;
	/** The figure at `runningSinceMs`, or the whole figure while held. The
	 *  widget shows `accumulatedSeconds + (now - runningSinceMs) / 1000`. */
	accumulatedSeconds: number;
	/** The slug of the workspace the timer belongs to. */
	workspace: string;
	/** For the sealed part only: never in the content state. */
	labels: { workspace: string; project: string | null; task: string };
};

export type TimerChange =
	| { type: "start" | "update"; timer: TimerSnapshot }
	| { type: "end" };

/** What iOS reads directly. Numbers and the slug only. */
export type TimerContentState =
	| {
			state: "running" | "held";
			runningSinceMs: number | null;
			accumulatedSeconds: number;
			workspace: string;
	  }
	| { state: "held"; runningSinceMs: null; accumulatedSeconds: 0 };

/** The sealed part of a timer push: the labels, which the relay must not
 *  read. Android also gets the content state in it. */
type SealedTimer =
	| { kind: "timer"; event: "end"; state?: TimerContentState }
	| {
			kind: "timer";
			event: "start" | "update";
			workspace: string;
			project: string | null;
			task: string;
			state?: TimerContentState;
	  };

/** The content state iOS reads directly. Numbers and the slug only, and
 *  `state` is only ever "running" or "held", the two cases the widget
 *  decodes. An end carries a held, empty state: the activity closes at once
 *  (`dismissalDate` is now), so nobody reads it. */
export const contentStateOf = (change: TimerChange): TimerContentState => {
	if (change.type === "end") {
		return { state: "held", runningSinceMs: null, accumulatedSeconds: 0 };
	}
	const { timer } = change;
	return {
		state: timer.state,
		runningSinceMs: timer.runningSinceMs,
		accumulatedSeconds: timer.accumulatedSeconds,
		workspace: timer.workspace.slice(0, 64),
	};
};

/** The sealed part of a timer push. */
const sealedTimerOf = (change: TimerChange): SealedTimer =>
	change.type === "end"
		? { kind: "timer", event: "end" }
		: {
				kind: "timer",
				event: change.type,
				workspace: truncateJson(change.timer.labels.workspace, 200),
				project:
					change.timer.labels.project === null
						? null
						: truncateJson(change.timer.labels.project, 200),
				task: truncateJson(change.timer.labels.task, 200),
			};

/** iOS: a Live Activity push. A start with no activity token is a
 *  push-to-start; any other change without a token waits for the app. */
const publishToIos = async (
	baseUrl: string,
	device: Device,
	change: TimerChange,
): Promise<void> => {
	const ciphertext = await seal(device, "liveactivity", sealedTimerOf(change));
	const contentState = contentStateOf(change);
	const nowSeconds = Math.floor(Date.now() / 1000);

	const pushToStart = () =>
		send(baseUrl, device, {
			relayId: device.relayId,
			kind: "liveactivity",
			ciphertext,
			liveActivity: {
				event: "start",
				contentState,
				attributesType: TIMER_ATTRIBUTES_TYPE,
				attributes: { version: TIMER_ACTIVITY_VERSION },
			},
		});

	const token = device.liveActivityToken;
	if (!token) {
		// Only a real start may open an activity. A pause sent before the app
		// gave its new token would open a second one.
		if (change.type === "start") await pushToStart();
		return;
	}

	const event: LiveActivityEvent = change.type === "end" ? "end" : "update";
	const liveActivity: RelayLiveActivity = { token, event, contentState };
	// An end closes the activity at once.
	if (event === "end") liveActivity.dismissalDate = nowSeconds;
	const outcome = await send(baseUrl, device, {
		relayId: device.relayId,
		kind: "liveactivity",
		ciphertext,
		liveActivity,
	});

	if (outcome.kind === "activity_gone") {
		await clearActivityToken(device, token);
		// The old activity is gone. A new timer still gets its own.
		if (change.type === "start") await pushToStart();
	} else if (outcome.kind === "delivered" && event === "end") {
		await clearActivityToken(device, token);
	}
};

/** Android: a data push. The app builds the ongoing notification itself, so
 *  the whole state is sealed and no per-activity token exists. */
const publishToAndroid = async (
	baseUrl: string,
	device: Device,
	change: TimerChange,
): Promise<void> => {
	// Android 13 and later shows nothing without the notification permission.
	if (!device.notificationsAllowed) return;
	await send(baseUrl, device, {
		relayId: device.relayId,
		kind: "data",
		ciphertext: await seal(device, "data", {
			...sealedTimerOf(change),
			state: contentStateOf(change),
		}),
	});
};

const publishNow = async (
	userId: string,
	change: TimerChange,
): Promise<void> => {
	const baseUrl = pushRelayUrl();
	if (!baseUrl) return;
	const devices = await liveDevices(userId);
	await Promise.all(
		devices.map((device) =>
			device.platform === "ios"
				? publishToIos(baseUrl, device, change)
				: publishToAndroid(baseUrl, device, change),
		),
	);
};

/** The last send of each person, so the next one waits for it. A pause and a
 *  resume a second apart must reach the phone in that order, or the widget
 *  shows "held" while the clock runs. */
const queues = new Map<string, Promise<void>>();

/**
 * Tell the person's phones about a timer change. Returns at once: the send
 * runs after the caller's write, in order for each person, and a failure is
 * logged and never thrown. Call it only after the write committed.
 */
export const publishTimerChange = (
	userId: string,
	change: TimerChange,
): void => {
	if (!pushRelayUrl()) return;
	const previous = queues.get(userId) ?? Promise.resolve();
	const next = previous
		.then(() => publishNow(userId, change))
		.catch((error: unknown) => {
			console.error("[native-push] timer change failed", { userId, error });
		});
	queues.set(userId, next);
	void next.finally(() => {
		if (queues.get(userId) === next) queues.delete(userId);
	});
};

/** Wait for every timer change in flight, so a test can read what was sent. */
export const settleNativePushForTests = async (): Promise<void> => {
	while (queues.size > 0) await Promise.all(queues.values());
};

/** The phone's public key in the stored form: the 65-byte point, base64url.
 *  Seals a test value with it, so a key that is not a P-256 point is refused
 *  here and not at the first push. Throws on a bad key. */
export const normalizePublicKey = async (value: string): Promise<string> => {
	const bytes = fromBase64Url(value);
	const point =
		bytes.byteLength === 64 ? new Uint8Array([0x04, ...bytes]) : bytes;
	await sealForDevice(point, new Uint8Array(0), PUSH_INFO);
	return toBase64Url(point);
};

/** Rows of other people, or other installations, that hold this relay id.
 *  One phone has one relay id, and the newest registration owns it. */
export const otherRowsWithRelayId = (
	userId: string,
	installationId: string,
	relayId: string,
) =>
	and(
		eq(mobileDevice.relayId, relayId),
		or(
			ne(mobileDevice.userId, userId),
			ne(mobileDevice.installationId, installationId),
		),
	);
