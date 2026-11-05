import {
	type Contrast,
	type Scheme,
	type ThemeId,
	type Tokens,
	themeTokens,
} from "./farmer-theme";
import type { Palette } from "./palette";
import type { ResolvedTheme } from "./theme.shared";

/**
 * A function that gives the theme for a theme id, a scheme and a contrast,
 * with the palette that `paletteOf` builds from the tokens. One object for
 * each combination, so a reader can compare themes by identity. Each call of
 * this function has its own cache, so two palettes never share an object.
 */
export const themeCache = (
	paletteOf: (tokens: Tokens, scheme: Scheme, contrast: Contrast) => Palette,
) => {
	const cache = new Map<string, ResolvedTheme>();
	return (
		themeId: ThemeId,
		scheme: Scheme,
		contrast: Contrast,
	): ResolvedTheme => {
		const key = `${themeId}:${scheme}:${contrast}`;
		const cached = cache.get(key);
		if (cached) return cached;
		const tokens = themeTokens(themeId, scheme, contrast);
		const theme: ResolvedTheme = {
			palette: paletteOf(tokens, scheme, contrast),
			scheme,
			contrast,
			themeId,
			dynamic: false,
			seedColor: tokens.acc,
		};
		cache.set(key, theme);
		return theme;
	};
};
