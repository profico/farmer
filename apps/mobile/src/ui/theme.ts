import { useDisplayPrefs } from "./display-prefs";
import {
	type Contrast,
	type Scheme,
	type ThemeId,
	themeTokens,
} from "./farmer-theme";
import { iosPaletteOf } from "./ios-palette";
import type { Palette } from "./palette";
import { type ResolvedTheme, useScheme } from "./theme.shared";

// The theme on iOS (and the fallback for any other platform). The colours
// of the screens are the iOS system colours (`ios-palette.ts`). The chosen
// theme colour, the farmer purple by default or one of the web's seeds, is
// the tint of the app. Light or dark and normal or high contrast follow
// More, "Display". The system materials of iOS, such as the tab bar and the
// sheets, stay the system's own.
// `theme.android.ts` adds Material You.

export type { ResolvedTheme } from "./theme.shared";

/** Whether this phone can take its colours from the wallpaper. */
export const isMaterialYouAvailable = false;

const cache = new Map<string, ResolvedTheme>();

/** One object for each combination, so a reader can compare by identity. */
const iosTheme = (
	themeId: ThemeId,
	scheme: Scheme,
	contrast: Contrast,
): ResolvedTheme => {
	const key = `${themeId}:${scheme}:${contrast}`;
	const cached = cache.get(key);
	if (cached) return cached;
	const tokens = themeTokens(themeId, scheme, contrast);
	const theme: ResolvedTheme = {
		palette: iosPaletteOf(tokens, scheme, contrast),
		scheme,
		contrast,
		themeId,
		dynamic: false,
		seedColor: tokens.acc,
	};
	cache.set(key, theme);
	return theme;
};

/** The theme in force. It changes at once when a display preference does. */
export const useTheme = (): ResolvedTheme => {
	const prefs = useDisplayPrefs();
	const scheme = useScheme();
	return iosTheme(prefs.theme, scheme, prefs.highContrast ? "high" : "normal");
};

/** The colour roles of the theme in force. */
export const usePalette = (): Palette => useTheme().palette;
