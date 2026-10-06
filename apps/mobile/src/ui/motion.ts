import { useSyncExternalStore } from "react";
import { AccessibilityInfo, Easing } from "react-native";

import { useDisplayPrefs } from "./display-prefs";

// The phone's own "Reduce motion" (iOS) or "Remove animations" (Android).
// Read once when the module loads, then kept current by the system event.

let systemReduceMotion = false;
const listeners = new Set<() => void>();

const setSystem = (value: boolean) => {
	if (value === systemReduceMotion) return;
	systemReduceMotion = value;
	for (const listener of listeners) listener();
};

AccessibilityInfo.isReduceMotionEnabled()
	.then(setSystem)
	.catch(() => {
		// No answer from the phone: the app's own switch still applies.
	});
AccessibilityInfo.addEventListener("reduceMotionChanged", setSystem);

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export type MotionPreference = {
	/** True when nothing on screen may move: the app's "Less motion" or the
	 *  phone's setting. A change of colour or opacity is still fine, as on
	 *  the web; a spinner keeps turning, because it is the information. */
	reduceMotion: boolean;
	/** The app's own switch (More, "Display"). */
	lessMotion: boolean;
	/** The phone's setting. */
	systemReduceMotion: boolean;
};

/** Whether the app may move things on screen. Read this before an
 *  animation, a slide or a pulse, and use a fade or no animation when
 *  `reduceMotion` is true. */
export function useMotionPreference(): MotionPreference {
	const { lessMotion } = useDisplayPrefs();
	const system = useSyncExternalStore(subscribe, () => systemReduceMotion);
	return {
		reduceMotion: lessMotion || system,
		lessMotion,
		systemReduceMotion: system,
	};
}

/** The strong ease-out for an element that enters or exits. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** Durations in milliseconds. */
export const MOTION_MS = { small: 150, enter: 300, exit: 250 } as const;
