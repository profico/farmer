import { useReducedMotion } from "motion/react";
import { usePreferences } from "#/hooks/use-preferences.ts";
import {
	ANIMATION_PROFILES,
	type AnimationProfile,
	REDUCED_MOTION_PROFILE,
} from "#/lib/animation.ts";

/**
 * Resolves the active motion profile from the user's `animationSpeed`
 * preference, with `prefers-reduced-motion` taking precedence (accessibility
 * wins over the explicit setting — it collapses to the no-movement profile).
 */
export function useAnimationProfile(): AnimationProfile {
	const { animationSpeed } = usePreferences();
	const reduce = useReducedMotion();
	return reduce ? REDUCED_MOTION_PROFILE : ANIMATION_PROFILES[animationSpeed];
}
