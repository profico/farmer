import { hexToOklch, mixHex, oklchToHex, withAlpha } from "./color";
import { type Contrast, farmerTokens, type Scheme } from "./farmer-theme";
import type { Palette } from "./palette";

// The palette on Android, from a Material 3 scheme. The scheme is the
// wallpaper's (Material You) or the one Compose builds from the seed colour
// of the theme (`SchemeTonalSpot`). `theme.android.ts` reads the scheme from
// `@expo/ui`. This file only maps it, so a test can run it.

/** The roles of `MaterialColors` (`@expo/ui/jetpack-compose`) that the
 *  palette uses. Each value is `#RRGGBBAA`. */
export type SchemeColors = {
	background: string;
	surface: string;
	surfaceDim: string;
	surfaceBright: string;
	surfaceContainerLowest: string;
	surfaceContainerLow: string;
	surfaceContainer: string;
	surfaceContainerHigh: string;
	surfaceContainerHighest: string;
	onSurface: string;
	onSurfaceVariant: string;
	primary: string;
	onPrimary: string;
	primaryContainer: string;
	onPrimaryContainer: string;
	inversePrimary: string;
	secondary: string;
	onSecondary: string;
	secondaryContainer: string;
	onSecondaryContainer: string;
	tertiary: string;
	onTertiary: string;
	tertiaryContainer: string;
	onTertiaryContainer: string;
	inverseSurface: string;
	inverseOnSurface: string;
	outline: string;
	outlineVariant: string;
	error: string;
	onError: string;
	errorContainer: string;
	onErrorContainer: string;
	scrim: string;
};

/** Hex without the alpha byte: Compose gives `#RRGGBBAA`. */
const rgb = (hex: string) => hex.slice(0, 7);

/** The shortest signed arc from one hue to another, in degrees. */
const arc = (from: number, to: number) =>
	((((to - from + 180) % 360) + 360) % 360) - 180;

/** The turn of a fixed colour towards the primary, as Material's
 *  `Blend.harmonize`: half of the arc, at most 15 degrees. */
const turnTowards = (from: number, to: number) =>
	Math.max(-15, Math.min(15, arc(from, to) * 0.5));

/**
 * Green and amber for the status roles. Material has none, so the farmer
 * ones keep their lightness and chroma, and their hue turns a little towards
 * the primary. The container is light and quiet in light mode, and the ink
 * on it is dark (tone 30 in light mode, as in Material 3 Expressive).
 */
const statusRoles = (primary: string, scheme: Scheme, contrast: Contrast) => {
	const dark = scheme === "dark";
	const high = contrast === "high";
	const base = farmerTokens(scheme, contrast);
	const hue = hexToOklch(primary).h;
	const role = (source: string) => {
		const from = hexToOklch(source);
		const h = from.h + turnTowards(from.h, hue);
		return {
			color: oklchToHex({ ...from, h }),
			container: oklchToHex({ l: dark ? 0.33 : 0.92, c: 0.045, h }),
			onContainer: oklchToHex({
				l: dark ? (high ? 0.95 : 0.9) : high ? 0.22 : 0.3,
				c: 0.06,
				h,
			}),
		};
	};
	return { success: role(base.ok), warning: role(base.warn) };
};

/**
 * The palette of a Material 3 scheme. High contrast draws the quiet text and
 * the lines harder, as on the web. The surfaces do not move, because Compose
 * draws its controls from the same scheme at standard contrast.
 */
export const materialPalette = (
	colors: SchemeColors,
	scheme: Scheme,
	contrast: Contrast,
): Palette => {
	const high = contrast === "high";
	const status = statusRoles(rgb(colors.primary), scheme, contrast);
	return {
		background: colors.background,
		surface: colors.surface,
		surfaceDim: colors.surfaceDim,
		surfaceBright: colors.surfaceBright,
		surfaceContainerLowest: colors.surfaceContainerLowest,
		surfaceContainerLow: colors.surfaceContainerLow,
		surfaceContainer: colors.surfaceContainer,
		surfaceContainerHigh: colors.surfaceContainerHigh,
		surfaceContainerHighest: colors.surfaceContainerHighest,
		onSurface: colors.onSurface,
		onSurfaceVariant: high
			? mixHex(rgb(colors.onSurfaceVariant), rgb(colors.onSurface), 0.4)
			: colors.onSurfaceVariant,
		primary: colors.primary,
		onPrimary: colors.onPrimary,
		primaryContainer: colors.primaryContainer,
		onPrimaryContainer: colors.onPrimaryContainer,
		secondary: colors.secondary,
		onSecondary: colors.onSecondary,
		secondaryContainer: colors.secondaryContainer,
		onSecondaryContainer: colors.onSecondaryContainer,
		tertiary: colors.tertiary,
		onTertiary: colors.onTertiary,
		tertiaryContainer: colors.tertiaryContainer,
		onTertiaryContainer: colors.onTertiaryContainer,
		inverseSurface: colors.inverseSurface,
		inverseOnSurface: colors.inverseOnSurface,
		inversePrimary: colors.inversePrimary,
		scrim: colors.scrim,
		outline: high ? colors.onSurfaceVariant : colors.outline,
		outlineVariant: high ? colors.outline : colors.outlineVariant,
		disabledContainer: withAlpha(rgb(colors.onSurface), 0.12),
		onDisabled: withAlpha(rgb(colors.onSurface), 0.38),
		error: colors.error,
		onError: colors.onError,
		errorContainer: colors.errorContainer,
		onErrorContainer: colors.onErrorContainer,
		success: status.success.color,
		successContainer: status.success.container,
		onSuccessContainer: status.success.onContainer,
		warning: status.warning.color,
		warningContainer: status.warning.container,
		onWarningContainer: status.warning.onContainer,
	};
};
