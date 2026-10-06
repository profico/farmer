import { useColorScheme } from "react-native";

import { useDisplayPrefs } from "./display-prefs";
import {
	type Contrast,
	paletteOf,
	type Scheme,
	type ThemeId,
} from "./farmer-theme";
import type { Palette } from "./palette";
import { themeCache } from "./theme-cache";

/** The theme in force: the colours and what they were made from. */
export type ResolvedTheme = {
	palette: Palette;
	scheme: Scheme;
	contrast: Contrast;
	/** The chosen theme colour. It does not apply while `dynamic` is true. */
	themeId: ThemeId;
	/** True when the colours come from the wallpaper (Material You). */
	dynamic: boolean;
	/** The colour a native control host (`@expo/ui` `Host`) takes as its
	 *  seed or tint. Undefined when the wallpaper colours apply. */
	seedColor: string | undefined;
};

/** Light or dark, after the person's choice (More, "Display"). */
export const useScheme = (): Scheme => {
	const { scheme } = useDisplayPrefs();
	const system = useColorScheme();
	if (scheme !== "system") return scheme;
	return system === "dark" ? "dark" : "light";
};

/** The farmer palette or a seed theme. */
export const farmerTheme = themeCache(paletteOf);
