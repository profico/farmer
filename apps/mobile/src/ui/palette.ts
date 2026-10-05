import type { ColorValue } from "react-native";

/** The farmer accent, the web's `--acc` in light mode. The live accent is
 *  `usePalette().primary`, which follows the chosen theme. */
export const SEED_COLOR = "#6f4ebe";

/** The colour roles the screens use, named as Material 3 names them. */
export type Palette = {
	background: ColorValue;
	surface: ColorValue;
	surfaceContainer: ColorValue;
	surfaceContainerHigh: ColorValue;
	onSurface: ColorValue;
	onSurfaceVariant: ColorValue;
	primary: ColorValue;
	onPrimary: ColorValue;
	primaryContainer: ColorValue;
	onPrimaryContainer: ColorValue;
	secondaryContainer: ColorValue;
	onSecondaryContainer: ColorValue;
	tertiary: ColorValue;
	outline: ColorValue;
	outlineVariant: ColorValue;
	error: ColorValue;
	errorContainer: ColorValue;
	onErrorContainer: ColorValue;
	/** Something on track, as the web's `--ok`. */
	success: ColorValue;
	/** Something to look at, as the web's `--warn`. */
	warning: ColorValue;
};
