import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { usePreferences } from "#/hooks/use-preferences.ts";
import { ANIMATION_PROFILES } from "#/lib/animation.ts";

// Applies the stored page-transition preference to the already-created
// router (getRouter() only reads it once, at startup) and to <html> for the
// CSS in styles.css that styles the "fade" vs "slide" view-transition pseudo-elements.
export function PreferencesSync() {
	const router = useRouter();
	const { pageTransition, animationSpeed } = usePreferences();

	useEffect(() => {
		// router.update() merges a partial at runtime (see router-core source);
		// its type demands the full options shape, so this cast is safe.
		router.update({
			defaultViewTransition: pageTransition !== "none",
		} as Parameters<typeof router.update>[0]);
		document.documentElement.dataset.transition = pageTransition;
	}, [router, pageTransition]);

	// The animation-speed dial scales the view-transition page changes: styles.css
	// multiplies its base duration by --motion-scale (see lib/animation.ts).
	useEffect(() => {
		document.documentElement.style.setProperty(
			"--motion-scale",
			String(ANIMATION_PROFILES[animationSpeed].cssScale),
		);
	}, [animationSpeed]);

	return null;
}
