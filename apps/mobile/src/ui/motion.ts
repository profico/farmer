import { useSyncExternalStore } from "react";
import { AccessibilityInfo, Easing } from "react-native";
import type { WithSpringConfig } from "react-native-reanimated";

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

// The Material 3 Expressive springs. Each spring has a mass of 1, a damping
// ratio and a stiffness. A spatial spring moves position, size and shape,
// and it may overshoot. An effects spring changes colour and opacity, and it
// never overshoots. Reanimated reads `dampingRatio` as a duration based
// spring, so each config gives the damping itself: 2 x ratio x sqrt(stiffness).

/** A spring config for `withSpring` (Reanimated) and `Animated.spring`
 *  (React Native). Both read the same three fields. */
export type SpringConfig = Required<
	Pick<WithSpringConfig, "mass" | "stiffness" | "damping">
>;

const spring = (ratio: number, stiffness: number): SpringConfig => ({
	mass: 1,
	stiffness,
	damping: 2 * ratio * Math.sqrt(stiffness),
});

export const SPRING = {
	fastSpatial: spring(0.6, 800),
} as const satisfies { [name: string]: SpringConfig };

export type SpringName = keyof typeof SPRING;

/** What an animation does for the current preference: a spring, or a short
 *  fade when `reduceMotion` is true. */
export type SpringChoice =
	| { reduced: false; spring: SpringConfig }
	| { reduced: true; fadeMs: number };

/** Choose the spring, or the fade for a person who wants less motion. A
 *  spatial spring moves things, so it gives the fade. An effects spring
 *  changes only colour and opacity, so it stays. */
export function springOrFade(
	name: SpringName,
	reduceMotion: boolean,
): SpringChoice {
	if (reduceMotion && name.endsWith("Spatial")) {
		return { reduced: true, fadeMs: MOTION_MS.small };
	}
	return { reduced: false, spring: SPRING[name] };
}

/** The same choice, read from `useMotionPreference()`. */
export function useSpring(name: SpringName): SpringChoice {
	return springOrFade(name, useMotionPreference().reduceMotion);
}
