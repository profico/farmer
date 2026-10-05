import type { ColorValue } from "react-native";

/** The farmer accent: the seed of the palette when the phone gives none. */
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
};
