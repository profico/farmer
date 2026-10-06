import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { z } from "zod";

import { localAlertData } from "./payload";
import { handleSealedPush, sealedOfTaskPayload } from "./receive";

/**
 * Native push, in the global scope of the bundle. The app's entry
 * (`index.ts`) imports this file before expo-router, because Android starts
 * the bundle without a screen to run the task for a data push when the app
 * is not running. A task that only a screen defines would never run then.
 *
 * Android: the relay sends a data message with no notification block. FCM
 * gives it to expo-notifications, which runs this task in every state of the
 * app (foreground, background, not running). The task opens the payload and
 * shows a local notification, or updates the timer notification. It is the
 * one path, so nothing shows twice.
 *
 * iOS: an alert arrives as a visible notification, and the Notification
 * Service Extension opens it before it shows. The timer goes to the Live
 * Activity. No task runs.
 */

export const PUSH_TASK = "farmer-push";

TaskManager.defineTask(PUSH_TASK, async ({ data, error }) => {
	if (error) {
		console.warn("[push] the push task failed", error.message);
		return;
	}
	const sealed = sealedOfTaskPayload(data);
	if (sealed) await handleSealedPush(sealed);
});

if (Platform.OS === "android") {
	Notifications.registerTaskAsync(PUSH_TASK).catch((error: Error) => {
		console.warn("[push] could not register the push task", error.message);
	});
}

/** A raw relay message: a data message whose sealed text only the task can
 *  read. It has nothing to show. */
const rawRelayMessage = z.object({ e: z.string() });

Notifications.setNotificationHandler({
	handleNotification: async (notification) => {
		const data = notification.request.content.data;
		// Android: the data message itself has no text. The task shows the
		// local notification that follows it.
		const hidden =
			Platform.OS === "android" &&
			rawRelayMessage.safeParse(data).success &&
			!localAlertData.safeParse(data).success;
		return {
			shouldShowBanner: !hidden,
			shouldShowList: !hidden,
			shouldPlaySound: !hidden,
			shouldSetBadge: false,
		};
	},
});
