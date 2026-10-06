import type { ColorValue } from "react-native";

/** The farmer accent, the web's `--acc` in light mode. The live accent is
 *  `usePalette().primary`, which follows the chosen theme. */
export const SEED_COLOR = "#6f4ebe";

/** The colour roles the screens use, named as Material 3 names them. */
export type Palette = {
	background: ColorValue;
	surface: ColorValue;
	surfaceDim: ColorValue;
	surfaceBright: ColorValue;
	surfaceContainerLowest: ColorValue;
	surfaceContainerLow: ColorValue;
	surfaceContainer: ColorValue;
	surfaceContainerHigh: ColorValue;
	surfaceContainerHighest: ColorValue;
	onSurface: ColorValue;
	onSurfaceVariant: ColorValue;
	primary: ColorValue;
	onPrimary: ColorValue;
	primaryContainer: ColorValue;
	onPrimaryContainer: ColorValue;
	secondary: ColorValue;
	onSecondary: ColorValue;
	secondaryContainer: ColorValue;
	onSecondaryContainer: ColorValue;
	tertiary: ColorValue;
	onTertiary: ColorValue;
	tertiaryContainer: ColorValue;
	onTertiaryContainer: ColorValue;
	inverseSurface: ColorValue;
	inverseOnSurface: ColorValue;
	inversePrimary: ColorValue;
	scrim: ColorValue;
	outline: ColorValue;
	outlineVariant: ColorValue;
	/** A disabled control, as Material 3 draws it: the container is the
	 *  on-surface colour at 12%, and the label or the icon is at 38%. */
	disabledContainer: ColorValue;
	onDisabled: ColorValue;
	error: ColorValue;
	onError: ColorValue;
	errorContainer: ColorValue;
	onErrorContainer: ColorValue;
	/** Something on track, as the web's `--ok`. */
	success: ColorValue;
	successContainer: ColorValue;
	onSuccessContainer: ColorValue;
	/** Something to look at, as the web's `--warn`. */
	warning: ColorValue;
	warningContainer: ColorValue;
	onWarningContainer: ColorValue;
};
