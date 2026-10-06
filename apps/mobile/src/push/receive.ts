import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { z } from "zod";

import { openPush } from "./keys";
import {
	type AlertPayload,
	alertPayload,
	appTargetOf,
	fcmData,
	type LocalAlertData,
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

/**
 * Open one sealed push and act on it: an alert becomes a local
 * notification, and a timer change updates the timer surface. A payload that
 * does not open or does not parse is dropped.
 */
export const handleSealedPush = async (sealed: string): Promise<void> => {
	const text = await openPush(sealed);
	if (!text) return;
	let json: ReturnType<typeof JSON.parse>;
	try {
		json = JSON.parse(text);
	} catch {
		return;
	}
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

/** The sealed value of a background task payload, or null. */
export const sealedOfTaskPayload = (
	payload: ReturnType<typeof JSON.parse>,
): string | null => {
	const parsed = taskPayload.safeParse(payload);
	if (!parsed.success) return null;
	return "data" in parsed.data
		? parsed.data.data.e
		: parsed.data.notification.data.e;
};
