import { bindingProof } from "@farmer/push-crypto/binding";
import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { z } from "zod";

import { LiveActivity } from "../../modules/live-activity";
import { APP_VERSION } from "../config";
import { activityBinding } from "./activity-binding";
import { devicePublicKey, forgetDeviceKey } from "./keys";
import {
	type ApnsEnvironment,
	registerWithRelay,
	removeFromRelay,
	updateRelay,
	type RelayUpdate,
} from "./relay";
import {
	type DevicePatch,
	registerDevice,
	removeDevice,
	serverRelayUrl,
	updateDevice,
} from "./server";
import {
	deleteItem,
	KEYS,
	readItem,
	readRelay,
	type RelayRegistration,
	writeItem,
	writeRelay,
} from "./storage";
import { forgetCredential } from "./timer-surface";

/**
 * Registration for native push (ADR 0006, `apps/push-relay/README.md`).
 *
 * 1. The Server says whether it uses a relay (`/meta` `pushRelay`). If not,
 *    the app does nothing more.
 * 2. The app gets the native push token (APNs or FCM) and registers with the
 *    relay. The relay answers a `relayId` and a `deviceSecret`.
 * 3. The app gives the Server `{ relayId, publicKey, relayProof }` with
 *    `POST /api/v1/me/devices`, an upsert, each time it comes to the
 *    foreground. The proof is an HMAC that only the holder of the device
 *    secret can make. The Server asks the relay to check it, when the relay
 *    id or the key is new, so nobody can take a relay id with a key of their
 *    own (`@farmer/push-crypto/binding`).
 *
 * The re-registration contract: the relay forgets a device that it has not
 * seen for 180 days, or whose token died. The app sends a `PUT` with its
 * token at most every few hours, and a `401` answer starts a new
 * registration. The Server deletes its row on a `404` `unknown_relay_id` or
 * a `410` `device_gone` from the relay, and the next foreground `POST`
 * writes it again.
 *
 * Without a Firebase configuration (no `google-services.json`) the native
 * token does not exist. The app logs that one time and goes on without push.
 */

/** How often the app checks its relay registration with a `PUT`. The relay
 *  allows 60 registration requests in 10 minutes for one address, and a
 *  whole office can share an address. */
const RELAY_CHECK_MS = 6 * 60 * 60 * 1000;

export type PushSession = { origin: string; token: string };

const logged = new Set<string>();
const logOnce = (key: string, message: string) => {
	if (logged.has(key)) return;
	logged.add(key);
	console.warn(`[push] ${message}`);
};

const extraSchema = z.object({
	apnsEnvironment: z.enum(["production", "sandbox"]).optional(),
});

/** The APNs environment of this build. The iOS config plugin writes it to
 *  `extra.apnsEnvironment`, with the same value as the entitlement. */
const apnsEnvironment = (): ApnsEnvironment =>
	extraSchema.safeParse(Constants.expoConfig?.extra ?? {}).data
		?.apnsEnvironment ?? "production";

export const installationId = async (): Promise<string> => {
	const stored = await readItem(KEYS.installation);
	if (stored) return stored;
	const created = randomUUID();
	await writeItem(KEYS.installation, created);
	return created;
};

/** Whether the person allows notifications. iOS counts a provisional grant. */
const notificationsAllowed = async (): Promise<boolean> => {
	const permission = await Notifications.getPermissionsAsync();
	return (
		permission.granted ||
		permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
	);
};

/**
 * Ask for the notification permission. Call it at a moment when the reason
 * is clear: from Preferences. Never at launch. A timer start asks through
 * `askForTimerNotifications` (`timer-permission.ts`). Returns whether
 * notifications are allowed now.
 */
export const requestNotificationPermission = async (): Promise<boolean> => {
	try {
		const current = await Notifications.getPermissionsAsync();
		if (current.granted || !current.canAskAgain) return current.granted;
		const answer = await Notifications.requestPermissionsAsync({
			ios: { allowAlert: true, allowBadge: false, allowSound: true },
		});
		return answer.granted;
	} catch (error) {
		logOnce("permission", `could not ask for notifications: ${String(error)}`);
		return false;
	}
};

/** The native push token, or null when this build cannot have one. */
const nativePushToken = async (): Promise<string | null> => {
	try {
		const token = await Notifications.getDevicePushTokenAsync();
		return String(token.data);
	} catch (error) {
		// Android without `google-services.json`: Firebase is not set up.
		logOnce("token", `no native push token, so no push: ${String(error)}`);
		return null;
	}
};

const pushToStartToken = (): string | null => {
	try {
		return LiveActivity?.pushToStartToken() ?? null;
	} catch {
		return null;
	}
};

/**
 * The number of the current session for push. A sign-out adds one, and a run
 * of `syncPush` that started before it checks the number before each write
 * and stops. Else a run in flight could write a relay registration, a device
 * key or the Server's row after the sign-out cleared them.
 */
let generation = 0;

/** A check that is true while no sign-out happened since the call. */
type Live = () => boolean;

const liveCheck = (): Live => {
	const mine = generation;
	return () => mine === generation;
};

/** A relay registration that is valid now, made or checked as needed. Null
 *  when it failed, or when a sign-out happened during the call. */
const ensureRelay = async (
	relayUrl: string,
	pushToken: string,
	live: Live,
): Promise<RelayRegistration | null> => {
	const platform = Platform.OS === "ios" ? "ios" : "android";
	const stored = await readRelay();
	// ActivityKit can answer no push-to-start token early in a process, while
	// the stored one is still valid. Keep the stored one then: a null here
	// would clear it on the relay. Only a sign-out removes it (DELETE).
	const startToken =
		platform === "ios"
			? (pushToStartToken() ?? stored?.pushToStartToken ?? null)
			: null;
	const now = Date.now();

	if (stored && stored.relayUrl === relayUrl) {
		const changed =
			stored.pushToken !== pushToken || stored.pushToStartToken !== startToken;
		if (!changed && now - stored.checkedAt < RELAY_CHECK_MS) return stored;
		const update: RelayUpdate = { pushToken };
		if (platform === "ios") {
			update.apnsEnvironment = apnsEnvironment();
			if (startToken) update.liveActivityPushToStartToken = startToken;
		}
		const answer = await updateRelay(relayUrl, stored, update);
		if (!live()) return null;
		if (answer === "ok") {
			const next = {
				...stored,
				pushToken,
				pushToStartToken: startToken,
				checkedAt: now,
			};
			await writeRelay(next);
			return next;
		}
		// A relay that is down keeps the old registration; only a 401 means
		// that the relay forgot the device.
		if (answer === "failed") return stored;
	} else if (stored) {
		// The Server now names another relay. Forget the old registration.
		await removeFromRelay(stored.relayUrl, stored);
	}

	try {
		const credentials = await registerWithRelay(relayUrl, {
			platform,
			pushToken,
			apnsEnvironment: apnsEnvironment(),
			liveActivityPushToStartToken: startToken,
		});
		if (!live()) {
			// The sign-out came first: this registration has no owner.
			await removeFromRelay(relayUrl, credentials);
			return null;
		}
		const next: RelayRegistration = {
			relayUrl,
			...credentials,
			pushToken,
			pushToStartToken: startToken,
			checkedAt: now,
		};
		await writeRelay(next);
		return next;
	} catch (error) {
		logOnce("relay", `the relay registration failed: ${String(error)}`);
		return null;
	}
};

/** The run of `syncPush` in flight, and the generation it belongs to. */
let inFlight: { generation: number; run: Promise<void> } | null = null;

/**
 * Register the phone for native push, or check the registration. Safe to
 * call on each foreground: it does nothing when push is off, and it never
 * throws. Two calls at the same time in one session share one run.
 */
export const syncPush = (session: PushSession): Promise<void> => {
	if (inFlight?.generation === generation) return inFlight.run;
	const entry = {
		generation,
		run: runSync(session, liveCheck()).finally(() => {
			if (inFlight === entry) inFlight = null;
		}),
	};
	inFlight = entry;
	return entry.run;
};

const runSync = async (session: PushSession, live: Live): Promise<void> => {
	try {
		let relayUrl: string | null;
		try {
			relayUrl = await serverRelayUrl(session.origin);
		} catch {
			return; // The Server is not reachable now. The next foreground tries.
		}
		if (!live()) return;
		if (!relayUrl) {
			await dropRelay();
			return;
		}
		const pushToken = await nativePushToken();
		if (!pushToken || !live()) return;
		const relay = await ensureRelay(relayUrl, pushToken, live);
		if (!relay || !live()) return;
		await bindActivityToken(live);
		const publicKey = await devicePublicKey();
		const allowed = await notificationsAllowed();
		const id = await installationId();
		if (!live()) return;
		const answer = await registerDevice(session.origin, session.token, {
			installationId: id,
			platform: Platform.OS === "ios" ? "ios" : "android",
			relayId: relay.relayId,
			publicKey,
			relayProof: bindingProof(relay.deviceSecret, relay.relayId, publicKey),
			appVersion: APP_VERSION,
			notificationsAllowed: allowed,
		});
		if (answer === "refused") {
			// An API token cannot register a phone (403). Not an error to show.
			logOnce("server", "the Server refused the phone registration");
		} else if (wantedActivityToken && live()) {
			// The Server clears a token that the relay refused. Send the running
			// one again, so a push-to-start does not replace a live activity.
			await updateDevice(session.origin, session.token, id, {
				liveActivityToken: wantedActivityToken,
			});
		}
	} catch (error) {
		logOnce("sync", `push registration failed: ${String(error)}`);
	}
};

/** The Live Activity token that the app learned last. A string is a running
 *  activity, null is "no activity", undefined is "nothing learned yet". The
 *  next `syncPush` sends it again when a relay call failed. */
let wantedActivityToken: string | null | undefined;

/** The token of the activity that runs now, or null. The native event for it
 *  fires when the module loads, before any listener exists, so after a restart
 *  the app reads it here. */
const runningActivityToken = (): string | null => {
	try {
		return LiveActivity?.activityPushToken() ?? null;
	} catch {
		return null;
	}
};

/** Bind the wanted Live Activity token at the relay (iOS). Never throws. */
const bindActivityToken = async (live: Live): Promise<void> => {
	try {
		// After a restart nothing has been learned yet. Ask the activity itself,
		// so a running activity is bound again.
		if (wantedActivityToken === undefined && Platform.OS === "ios") {
			wantedActivityToken = runningActivityToken();
		}
		const stored = await readRelay();
		if (!stored) return;
		const platform = Platform.OS === "ios" ? "ios" : "android";
		const update = activityBinding(
			platform,
			wantedActivityToken,
			stored.activityToken,
		);
		if (!update) return;
		const answer = await updateRelay(stored.relayUrl, stored, update);
		if (answer === "ok" && live()) {
			await writeRelay({
				...stored,
				activityToken: update.liveActivityToken ?? null,
			});
		} else if (answer !== "ok") {
			// The next `syncPush` tries again. A 401 starts a new registration.
			logOnce(
				"activity",
				`the relay did not take the activity token: ${answer}`,
			);
		}
	} catch (error) {
		logOnce("activity", `could not bind the activity token: ${String(error)}`);
	}
};

/**
 * Tell the Server and the relay about this phone's Live Activity token
 * (iOS). A null token means that the activity ended. The two calls run
 * together, and one failure does not stop the other.
 */
export const reportLiveActivityToken = async (
	session: PushSession,
	patch: DevicePatch,
): Promise<void> => {
	if (patch.liveActivityToken !== undefined) {
		wantedActivityToken = patch.liveActivityToken;
	}
	if (!(await readRelay())) return;
	const live = liveCheck();
	const toServer = async () =>
		updateDevice(session.origin, session.token, await installationId(), patch);
	const results = await Promise.allSettled([
		toServer(),
		bindActivityToken(live),
	]);
	if (results[0].status === "rejected") {
		logOnce(
			"activity-server",
			`Server activity report: ${String(results[0].reason)}`,
		);
	}
};

/** Tell the relay about a new push-to-start token (iOS). */
export const reportPushToStartToken = async (token: string): Promise<void> => {
	const live = liveCheck();
	const stored = await readRelay();
	if (!stored || stored.pushToStartToken === token) return;
	const answer = await updateRelay(stored.relayUrl, stored, {
		liveActivityPushToStartToken: token,
	});
	if (answer === "ok" && live()) {
		await writeRelay({
			...stored,
			pushToStartToken: token,
			checkedAt: Date.now(),
		});
	}
};

/** Forget the relay registration, here and on the relay. */
const dropRelay = async (): Promise<void> => {
	const stored = await readRelay();
	if (!stored) return;
	await removeFromRelay(stored.relayUrl, stored);
	await deleteItem(KEYS.relay);
};

/** The longest time that a sign-out waits for the Server to delete the
 *  phone's row. An offline phone must still sign out at once. */
const UNREGISTER_WAIT_MS = 5_000;

/**
 * Sign-out, before the token is revoked: delete the phone's row on the
 * Server (`DELETE /api/v1/me/devices/{id}`). The revoke also deletes the
 * row, but a revoke that fails offline does not. A phone that never
 * registered has no installation id, and sends nothing. Never throws.
 */
export const unregisterDevice = async (session: PushSession): Promise<void> => {
	try {
		const id = await readItem(KEYS.installation);
		if (!id) return;
		await Promise.race([
			removeDevice(session.origin, session.token, id),
			new Promise((resolve) => setTimeout(resolve, UNREGISTER_WAIT_MS)),
		]);
	} catch (error) {
		logOnce("unregister", `could not remove the device: ${String(error)}`);
	}
};

/** The longest time that a sign-out waits for a `syncPush` in flight to
 *  stop, before it removes the relay registration. */
const SYNC_STOP_WAIT_MS = 5_000;

/**
 * Sign-out. The Server deletes the phone's row with the session
 * (`mobile_device.session_id` cascades), so only the relay registration, the
 * device key and the shared credential are left to remove here. A new
 * person on this phone gets a new key and a new relay id.
 *
 * The local items go first: the device key, which opens each push, and the
 * native copy of the token, which the timer surfaces use. Each step runs
 * even when the one before it failed. The relay `DELETE` needs the network,
 * so it comes last. A `syncPush` in flight stops at its next check.
 */
export const teardownPush = async (): Promise<void> => {
	generation += 1;
	const running = inFlight?.run;
	const steps: [string, () => Promise<void>][] = [
		["key", forgetDeviceKey],
		["credential", forgetCredential],
		[
			"sync",
			() =>
				Promise.race([
					running ?? Promise.resolve(),
					new Promise<void>((resolve) =>
						setTimeout(resolve, SYNC_STOP_WAIT_MS),
					),
				]),
		],
		["relay", dropRelay],
	];
	for (const [name, step] of steps) {
		try {
			await step();
		} catch (error) {
			logOnce(`teardown-${name}`, `push sign-out failed: ${String(error)}`);
		}
	}
};
