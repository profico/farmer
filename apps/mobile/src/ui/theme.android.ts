import {
	isDynamicColorAvailable,
	type MaterialColors,
	useMaterialColors,
} from "@expo/ui/jetpack-compose";
import { useMemo } from "react";

import { mixHex } from "./color";
import { useDisplayPrefs } from "./display-prefs";
import { type Contrast, farmerTokens, type Scheme } from "./farmer-theme";
import type { Palette } from "./palette";
import { farmerTheme, type ResolvedTheme, useScheme } from "./theme.shared";

// The theme on Android. Material You (the wallpaper's colours, Android 12 and
// later) is on by default. With it off, or on a phone without it, the farmer
// palette or the chosen seed theme applies, as on iOS (`theme.ts`).

export type { ResolvedTheme } from "./theme.shared";

/** Whether this phone can take its colours from the wallpaper. */
export const isMaterialYouAvailable = isDynamicColorAvailable;

/** Hex without the alpha byte: Compose gives `#RRGGBBAA`. */
const rgb = (hex: string) => hex.slice(0, 7);

const materialPalette = (
	colors: MaterialColors,
	scheme: Scheme,
	contrast: Contrast,
): Palette => {
	// Material You has no green or amber. The farmer ones are used, as the
	// web's status colours stay near their own hue for any seed.
	const status = farmerTokens(scheme, contrast);
	const high = contrast === "high";
	return {
		background: colors.background,
		surface: colors.surface,
		surfaceContainer: colors.surfaceContainer,
		surfaceContainerHigh: colors.surfaceContainerHigh,
		onSurface: colors.onSurface,
		// High contrast draws the quiet text and the lines harder, as on the
		// web; the surfaces do not move.
		onSurfaceVariant: high
			? mixHex(rgb(colors.onSurfaceVariant), rgb(colors.onSurface), 0.4)
			: colors.onSurfaceVariant,
		primary: colors.primary,
		onPrimary: colors.onPrimary,
		primaryContainer: colors.primaryContainer,
		onPrimaryContainer: colors.onPrimaryContainer,
		secondaryContainer: colors.secondaryContainer,
		onSecondaryContainer: colors.onSecondaryContainer,
		tertiary: colors.tertiary,
		outline: high ? colors.onSurfaceVariant : colors.outline,
		outlineVariant: high ? colors.outline : colors.outlineVariant,
		error: colors.error,
		errorContainer: colors.errorContainer,
		onErrorContainer: colors.onErrorContainer,
		success: status.ok,
		warning: status.warn,
	};
};

/** The theme in force. It changes at once when a display preference does. */
export const useTheme = (): ResolvedTheme => {
	const prefs = useDisplayPrefs();
	const scheme = useScheme();
	const contrast: Contrast = prefs.highContrast ? "high" : "normal";
	const dynamic = prefs.materialYou && isDynamicColorAvailable;
	const colors = useMaterialColors({ colorScheme: scheme });
	return useMemo(
		() =>
			dynamic
				? {
						palette: materialPalette(colors, scheme, contrast),
						scheme,
						contrast,
						themeId: prefs.theme,
						dynamic: true,
						seedColor: undefined,
					}
				: farmerTheme(prefs.theme, scheme, contrast),
		[dynamic, colors, scheme, contrast, prefs.theme],
	);
};

/** The colour roles of the theme in force. */
export const usePalette = (): Palette => useTheme().palette;
