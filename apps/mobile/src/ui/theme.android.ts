import {
	isDynamicColorAvailable,
	useMaterialColors,
} from "@expo/ui/jetpack-compose";
import { useMemo } from "react";

import { useDisplayPrefs } from "./display-prefs";
import type { Contrast } from "./farmer-theme";
import { materialPalette } from "./material-palette";
import type { Palette } from "./palette";
import { farmerTheme, type ResolvedTheme, useScheme } from "./theme.shared";

// The theme on Android. Material You (the wallpaper's colours, Android 12 and
// later) is on by default. With it off, or on a phone without it, the chosen
// seed theme applies. Compose builds its scheme from the seed colour
// (`SchemeTonalSpot`). The palette of the screens reads the same scheme from
// `useMaterialColors`, so the native controls and the screens agree.
// iOS keeps the farmer palette (`theme.ts`).

export type { ResolvedTheme } from "./theme.shared";

/** Whether this phone can take its colours from the wallpaper. */
export const isMaterialYouAvailable = isDynamicColorAvailable;

/** The theme in force. It changes at once when a display preference does. */
export const useTheme = (): ResolvedTheme => {
	const prefs = useDisplayPrefs();
	const scheme = useScheme();
	const contrast: Contrast = prefs.highContrast ? "high" : "normal";
	const dynamic = prefs.materialYou && isDynamicColorAvailable;
	// This seed is the one that `ControlHost` gives to Compose.
	const seed = farmerTheme(prefs.theme, scheme, contrast).seedColor;
	const seedColor = dynamic ? undefined : seed;
	const colors = useMaterialColors({ colorScheme: scheme, seedColor });
	return useMemo(
		() => ({
			palette: materialPalette(colors, scheme, contrast),
			scheme,
			contrast,
			themeId: prefs.theme,
			dynamic,
			seedColor,
		}),
		[colors, scheme, contrast, dynamic, prefs.theme, seedColor],
	);
};

/** The colour roles of the theme in force. */
export const usePalette = (): Palette => useTheme().palette;
