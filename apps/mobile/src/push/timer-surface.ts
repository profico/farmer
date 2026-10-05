import type { Timer } from "@farmer/api-client";
import * as Linking from "expo-linking";
import { Platform } from "react-native";

import { LiveActivity } from "../../modules/live-activity";
import { TimerNotification } from "../../modules/timer-notification";
import { USER_AGENT } from "../config";
import type { TimerContentState } from "./payload";
import { deleteItem, KEYS, writeItem } from "./storage";

/**
 * The timer outside the app: the ongoing notification on Android and the
 * Live Activity on iOS. Both show the elapsed time only. Stop opens the stop
 * sheet, where the person confirms the figure (ADR 0003): nothing confirms
 * an entry from the lock screen.
 */

/** What the surface shows. The figure is `elapsedSeconds` at `anchorMs`, on
 *  the phone's clock. */
export type TimerSurface = {
	paused: boolean;
	elapsedSeconds: number;
	anchorMs: number;
	workspaceSlug: string;
	workspaceName: string;
	project: string | null;
	task: string;
};

/** The query parameter that marks a link from a timer surface. */
export const SURFACE_SOURCE = "timer-surface";

/** The surface of a timer that the API answered at `receivedAt`. Null for a
 *  dropped timer: it measures nothing, and the app shows its notice. */
export const surfaceOfTimer = (
	timer: Timer,
	receivedAt: number,
): TimerSurface | null =>
	timer.droppedAt
		? null
		: {
				paused: timer.paused,
				elapsedSeconds: timer.elapsedSeconds,
				anchorMs: receivedAt,
				workspaceSlug: timer.organization.slug,
				workspaceName: timer.organization.name,
				project: timer.project?.name ?? null,
				task: timer.task.name,
			};

/** The surface of a timer push. The Server's clock and the phone's differ
 *  by a little; the figure is computed at arrival, as the widget does. */
export const surfaceOfPush = (
	state: TimerContentState,
	labels: { workspace: string; project: string | null; task: string },
	nowMs: number,
): TimerSurface => {
	const running = state.state === "running" && state.runningSinceMs !== null;
	const extra = running
		? Math.max(0, (nowMs - (state.runningSinceMs ?? nowMs)) / 1000)
		: 0;
	return {
		paused: !running,
		elapsedSeconds: state.accumulatedSeconds + extra,
		anchorMs: nowMs,
		workspaceSlug: state.workspace ?? "",
		workspaceName: labels.workspace,
		project: labels.project,
		task: labels.task,
	};
};

const titleOf = (surface: TimerSurface) =>
	[surface.project ?? "No project", surface.task].join(" · ");

/** The content state of the Live Activity for a surface: the same shape as
 *  the Server's pushes, so the widget reads one format. */
const contentStateOf = (surface: TimerSurface) => ({
	state: surface.paused ? ("held" as const) : ("running" as const),
	runningSinceMs: surface.paused ? null : surface.anchorMs,
	accumulatedSeconds: surface.elapsedSeconds,
	workspace: surface.workspaceSlug,
});

/** Show or update the timer outside the app. Never throws. */
export const showTimerSurface = (surface: TimerSurface): void => {
	try {
		if (Platform.OS === "android") {
			TimerNotification?.show({
				title: titleOf(surface),
				text: surface.workspaceName,
				paused: surface.paused,
				elapsedSeconds: surface.elapsedSeconds,
				anchorMs: surface.anchorMs,
				workspace: surface.workspaceSlug,
				stopUrl: Linking.createURL("/stop-timer", {
					queryParams: { source: SURFACE_SOURCE },
				}),
				openUrl: Linking.createURL("/"),
			});
		} else if (Platform.OS === "ios") {
			LiveActivity?.show(
				{
					workspaceName: surface.workspaceName,
					project: surface.project,
					task: surface.task,
				},
				contentStateOf(surface),
			);
		}
	} catch (error) {
		console.warn("[push] could not show the timer surface", error);
	}
};

/** Remove the timer from outside the app. Never throws. */
export const clearTimerSurface = (): void => {
	try {
		TimerNotification?.hide();
		LiveActivity?.endAll();
	} catch (error) {
		console.warn("[push] could not clear the timer surface", error);
	}
};

/**
 * Give the native side the session, so that Pause and Resume work while the
 * app does not run: the Android receiver and the Live Activity's App Intent
 * call the Server themselves. Android keeps the token encrypted with a
 * Keystore key; iOS keeps it in the app group's Keychain.
 */
export const shareCredential = async (
	origin: string,
	token: string,
): Promise<void> => {
	try {
		if (Platform.OS === "android") {
			TimerNotification?.setCredential(origin, token, USER_AGENT);
		} else if (Platform.OS === "ios") {
			await writeItem(KEYS.credential, JSON.stringify({ origin, token }));
		}
	} catch (error) {
		console.warn("[push] could not share the credential", error);
	}
};

/** Forget the shared session: on sign-out and on a change of Server. */
export const forgetCredential = async (): Promise<void> => {
	try {
		TimerNotification?.clearCredential();
		if (Platform.OS === "ios") await deleteItem(KEYS.credential);
	} catch (error) {
		console.warn("[push] could not forget the credential", error);
	}
};
