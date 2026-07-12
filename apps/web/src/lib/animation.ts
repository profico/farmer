import type { Transition } from "motion/react";
import type { AnimationSpeed } from "#/lib/preferences.ts";

/**
 * The one place that turns the user's `animationSpeed` preference into concrete
 * motion values. Every animation that respects the setting — the segmented-tab
 * pill, the panel/page crossfades (FadeSwap), and the CSS view-transition page
 * changes — derives its timing from a single profile here, so the four steps
 * stay coherent instead of each component inventing its own numbers.
 *
 * Speeds progress off → theatrical:
 *   instant  — no motion at all (matches prefers-reduced-motion behaviour)
 *   nicer    — quick and crisp, no overshoot
 *   eyecandy — the tuned default: a little spring, a little travel
 *   whoa     — slow, bouncy, exaggerated travel
 */
export type AnimationProfile = {
	/** Multiplier on `--motion-duration-fast` for CSS view-transition pages. */
	cssScale: number;
	/** Sliding-pill layout move in the segmented control. */
	pill: Transition;
	/** FadeSwap crossfade: travel distance (px) the panel lifts through. */
	fadeOffset: number;
	/** FadeSwap timing. */
	fadeTransition: Transition;
};

const spring = (bounce: number, visualDuration: number): Transition => ({
	type: "spring",
	bounce,
	visualDuration,
});

// `instant` is also what we fall back to under prefers-reduced-motion — a plain
// `duration: 0` so panels swap and pills jump with no movement.
const INSTANT: AnimationProfile = {
	cssScale: 0,
	pill: { duration: 0 },
	fadeOffset: 0,
	fadeTransition: { duration: 0 },
};

export const ANIMATION_PROFILES: Record<AnimationSpeed, AnimationProfile> = {
	instant: INSTANT,
	nicer: {
		cssScale: 0.7,
		pill: spring(0, 0.14),
		fadeOffset: 4,
		fadeTransition: { duration: 0.13, ease: [0.32, 0.72, 0, 1] },
	},
	eyecandy: {
		cssScale: 2.6,
		pill: spring(0.32, 0.36),
		fadeOffset: 14,
		fadeTransition: { duration: 0.36, ease: [0.32, 0.72, 0, 1] },
	},
	whoa: {
		cssScale: 4,
		pill: spring(0.55, 0.42),
		fadeOffset: 22,
		fadeTransition: spring(0.5, 0.42),
	},
};

export const REDUCED_MOTION_PROFILE = INSTANT;
