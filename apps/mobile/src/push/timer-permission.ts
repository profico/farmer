import { useSyncExternalStore } from "react";

/**
 * The notification permission for the ongoing timer notification (Android
 * 13 and later need `POST_NOTIFICATIONS` for it). The notification is local:
 * it needs no push relay and no `/meta` feature.
 *
 * The app asks at each timer start in the app while the permission is not
 * granted and the system can still show its dialog (`canAskAgain`). The
 * system itself stops the dialog after the second "Don't allow", so the app
 * keeps no "asked" mark of its own. An earlier version kept such a mark: one
 * dialog that the person closed without an answer then stopped every later
 * ask, and the timer never showed outside the app.
 */

export type PermissionState = { granted: boolean; canAskAgain: boolean };

export type PermissionApi = {
	get: () => Promise<PermissionState>;
	request: () => Promise<PermissionState>;
};

export type AskResult = {
	/** The permission is granted after the call. */
	granted: boolean;
	/** The app showed the system dialog. */
	asked: boolean;
};

/** Ask for the permission when it is not granted and the system can ask.
 *  Never throws: a failure counts as "not granted". */
export const askForTimerNotifications = async (
	api: PermissionApi,
): Promise<AskResult> => {
	try {
		const current = await api.get();
		if (current.granted) return { granted: true, asked: false };
		if (!current.canAskAgain) return { granted: false, asked: false };
		const answer = await api.request();
		return { granted: answer.granted, asked: true };
	} catch {
		return { granted: false, asked: false };
	}
};

/** Whether the hint on the timer card must show after a start: the
 *  permission is not granted, and the hint never showed before. */
export const needsDeniedHint = (result: AskResult, hintShown: boolean) =>
	!result.granted && !hintShown;

// The hint "Notifications are off" on the timer card. The bridge sets it
// after a start; the card reads it and clears it.
let hintVisible = false;
const listeners = new Set<() => void>();

const setHint = (value: boolean) => {
	if (hintVisible === value) return;
	hintVisible = value;
	for (const listener of listeners) listener();
};

export const showDeniedHint = () => setHint(true);
export const hideDeniedHint = () => setHint(false);

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/** True while the timer card must show the hint. */
export const useDeniedHint = (): boolean =>
	useSyncExternalStore(subscribe, () => hintVisible);
