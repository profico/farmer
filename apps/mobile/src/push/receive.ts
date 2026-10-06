import { checkFreshness, rememberPushId } from "@farmer/push-crypto/freshness";
import * as Notifications from "expo-notifications";
import Storage from "expo-sqlite/kv-store";
import { Platform } from "react-native";
import { z } from "zod";

import { openPush } from "./keys";
import {
	type AlertPayload,
	alertPayload,
	appTargetOf,
	fcmData,
	type LocalAlertData,
	pushEnvelopeSchema,
	timerPayload,
	type TimerPayload,
} from "./payload";
import {
	clearTimerSurface,
	showTimerSurface,
	surfaceOfPush,
} from "./timer-surface";

/** The Android channel of the alerts: the log reminder, "timer dropped" and
 *  the kinds that the app takes from Slack. */
export const ALERT_CHANNEL = "reminders";

/** Listeners in this JavaScript context that want to know about a timer
 *  push, so a screen in the foreground reads the timer again. */
const timerListeners = new Set<() => void>();

export const onTimerPush = (listener: () => void): (() => void) => {
	timerListeners.add(listener);
	return () => timerListeners.delete(listener);
};

let channelReady: Promise<void> | null = null;

const ensureAlertChannel = (): Promise<void> => {
	if (Platform.OS !== "android") return Promise.resolve();
	channelReady ??= Notifications.setNotificationChannelAsync(ALERT_CHANNEL, {
		name: "Reminders",
		description: "Reminders to log time, and a timer that was dropped.",
		importance: Notifications.AndroidImportance.DEFAULT,
	}).then(() => undefined);
	return channelReady;
};

const presentAlert = async (alert: AlertPayload): Promise<void> => {
	await ensureAlertChannel();
	const target = appTargetOf(alert.url);
	const data: LocalAlertData = {
		farmer: "alert",
		path: target.path,
		workspace: target.workspace,
	};
	await Notifications.scheduleNotificationAsync({
		content: { title: alert.title, body: alert.body, data },
		trigger: Platform.OS === "android" ? { channelId: ALERT_CHANNEL } : null,
	});
};

const applyTimer = (payload: TimerPayload): void => {
	if (payload.event === "end") {
		clearTimerSurface();
	} else if (payload.state) {
		showTimerSurface(
			surfaceOfPush(
				payload.state,
				{
					workspace: payload.workspace,
					project: payload.project,
					task: payload.task,
				},
				Date.now(),
			),
		);
	}
	for (const listener of timerListeners) listener();
};

/** The kv key of the ids of the last pushes that the app accepted. The kv
 *  store and not memory: Android runs the push task in a new JavaScript
 *  context for a push that wakes the app, so a list in memory is empty each
 *  time. */
const SEEN_KEY = "farmer.push.seen-ids";

const seenIds = z.array(z.string());

const readSeen = (): string[] => {
	try {
		const stored = Storage.getItemSync(SEEN_KEY);
		const parsed = seenIds.safeParse(stored ? JSON.parse(stored) : []);
		return parsed.success ? parsed.data : [];
	} catch {
		return [];
	}
};

/** Whether the app accepts a payload: the kind of its push, its age and its
 *  id (`@farmer/push-crypto/freshness`). An accepted id goes into the seen
 *  list. The read, the check and the write are synchronous, so two pushes
 *  cannot both pass with one id. */
const acceptFresh = (
	json: ReturnType<typeof JSON.parse>,
	receivedKind: string | null,
): boolean => {
	const envelope = pushEnvelopeSchema.safeParse(json);
	if (!envelope.success) return false;
	const seen = readSeen();
	const verdict = checkFreshness(envelope.data, receivedKind, Date.now(), seen);
	if (verdict !== "ok") {
		console.warn("[push] refused a push", verdict);
		return false;
	}
	try {
		Storage.setItemSync(
			SEEN_KEY,
			JSON.stringify(rememberPushId(seen, envelope.data.id)),
		);
	} catch {
		// A store that cannot be written still shows this push.
	}
	return true;
};

/**
 * Open one sealed push and act on it: an alert becomes a local
 * notification, and a timer change updates the timer surface. A payload that
 * does not open or does not parse is dropped, and so is one that came in a
 * push of another kind, is older than a day, or was seen already.
 */
export const handleSealedPush = async (push: SealedPush): Promise<void> => {
	const text = await openPush(push.sealed);
	if (!text) return;
	let json: ReturnType<typeof JSON.parse>;
	try {
		json = JSON.parse(text);
	} catch {
		return;
	}
	if (!acceptFresh(json, push.kind)) return;
	const timer = timerPayload.safeParse(json);
	if (timer.success) {
		applyTimer(timer.data);
		return;
	}
	const alert = alertPayload.safeParse(json);
	if (alert.success) await presentAlert(alert.data);
};

/** The task payload of expo-notifications on Android: the FCM message, with
 *  its data map under `data`. */
const taskPayload = z.union([
	z.object({ data: fcmData }),
	z.object({ notification: z.object({ data: fcmData }) }),
]);

/** A sealed value and the relay kind of the push that brought it (null when
 *  the push did not say). */
export type SealedPush = { sealed: string; kind: string | null };

/** The sealed value of a background task payload, or null. */
export const sealedOfTaskPayload = (
	payload: ReturnType<typeof JSON.parse>,
): SealedPush | null => {
	const parsed = taskPayload.safeParse(payload);
	if (!parsed.success) return null;
	const data =
		"data" in parsed.data ? parsed.data.data : parsed.data.notification.data;
	return { sealed: data.e, kind: data.k ?? null };
};
