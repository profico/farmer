import {
	checkFreshness,
	emptyPushSeen,
	type PushEnvelope,
	type PushSeen,
	rememberPushId,
} from "@farmer/push-crypto/freshness";
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

/** The kv key of the ids of the pushes that the app accepted. The kv
 *  store and not memory: Android runs the push task in a new JavaScript
 *  context for a push that wakes the app, so a list in memory is empty each
 *  time. */
const SEEN_KEY = "farmer.push.seen-ids";

const seenState = z.object({
	floor: z.number(),
	entries: z.array(z.object({ id: z.string(), at: z.number() })),
});

const readSeen = (): PushSeen => {
	try {
		const stored = Storage.getItemSync(SEEN_KEY);
		if (!stored) return emptyPushSeen();
		const parsed = seenState.safeParse(JSON.parse(stored));
		return parsed.success ? parsed.data : emptyPushSeen();
	} catch {
		return emptyPushSeen();
	}
};

/** Whether the app accepts a payload: the kind of its push, its age, its
 *  send time and its id (`@farmer/push-crypto/freshness`). An accepted id goes into the seen
 *  list. The read, the check and the write are synchronous, so two pushes
 *  cannot both pass with one id. */
const acceptFresh = (
	json: ReturnType<typeof JSON.parse>,
	receivedKind: string | null,
): PushEnvelope | null => {
	const envelope = pushEnvelopeSchema.safeParse(json);
	if (!envelope.success) return null;
	const seen = readSeen();
	const verdict = checkFreshness(envelope.data, receivedKind, Date.now(), seen);
	if (verdict !== "ok") {
		console.warn("[push] refused a push", verdict);
		return null;
	}
	try {
		Storage.setItemSync(
			SEEN_KEY,
			JSON.stringify(rememberPushId(seen, envelope.data, Date.now())),
		);
	} catch {
		// A store that cannot be written still shows this push.
	}
	return envelope.data;
};

/** The kv key of the `sentAt` of the last timer push that the app applied.
 *  The kv store, for the same reason as the seen list. */
const TIMER_SENT_AT_KEY = "farmer.push.timer-sent-at";

const readTimerSentAt = (): number => {
	try {
		const parsed = z
			.number()
			.safeParse(Number(Storage.getItemSync(TIMER_SENT_AT_KEY)));
		return parsed.success ? parsed.data : 0;
	} catch {
		return 0;
	}
};

/** Whether a timer push is older than the last one that the app applied.
 *  FCM does not keep the order of data messages, so a late "pause" must not
 *  undo a "resume" that came first. Two pushes with the same `sentAt` both
 *  apply, because their order is not known and the later arrival is the
 *  better guess. The read, the check and the write are synchronous. */
const supersededTimer = (sentAt: number): boolean => {
	if (sentAt < readTimerSentAt()) return true;
	try {
		Storage.setItemSync(TIMER_SENT_AT_KEY, String(sentAt));
	} catch {
		// A store that cannot be written still applies this push.
	}
	return false;
};

/**
 * Open one sealed push and act on it: an alert becomes a local
 * notification, and a timer change updates the timer surface. A payload that
 * does not open or does not parse is dropped, and so is one that came in a
 * push of another kind, is older than a day, or was seen already. A timer payload that is older
 * than the last one that the app applied is dropped too.
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
	const envelope = acceptFresh(json, push.kind);
	if (!envelope) return;
	const timer = timerPayload.safeParse(json);
	if (timer.success) {
		if (supersededTimer(envelope.sentAt)) {
			console.warn("[push] dropped a timer push older than the last");
			return;
		}
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
