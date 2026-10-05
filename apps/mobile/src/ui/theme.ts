import { useDisplayPrefs } from "./display-prefs";
import type { Palette } from "./palette";
import { farmerTheme, type ResolvedTheme, useScheme } from "./theme.shared";

// The theme on iOS (and the fallback for any other platform). The farmer
// palette by default, or one of the web's seed themes, in light or dark and
// in normal or high contrast (More, "Display"). The system materials of iOS,
// such as the tab bar and the sheets, stay the system's own.
// `theme.android.ts` adds Material You.

export type { ResolvedTheme } from "./theme.shared";

/** Whether this phone can take its colours from the wallpaper. */
export const isMaterialYouAvailable = false;

/** The theme in force. It changes at once when a display preference does. */
export const useTheme = (): ResolvedTheme => {
	const prefs = useDisplayPrefs();
	const scheme = useScheme();
	return farmerTheme(
		prefs.theme,
		scheme,
		prefs.highContrast ? "high" : "normal",
	);
};

/** The colour roles of the theme in force. */
export const usePalette = (): Palette => useTheme().palette;
