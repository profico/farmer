import { PlatformColor } from "react-native";

import { type Palette, SEED_COLOR } from "./palette";

// The system colours, which follow light and dark mode by themselves. The
// farmer accent is the tint, as an iOS app uses its accent colour.
const palette: Palette = {
	background: PlatformColor("systemGroupedBackground"),
	surface: PlatformColor("systemBackground"),
	surfaceContainer: PlatformColor("secondarySystemGroupedBackground"),
	surfaceContainerHigh: PlatformColor("tertiarySystemGroupedBackground"),
	onSurface: PlatformColor("label"),
	onSurfaceVariant: PlatformColor("secondaryLabel"),
	primary: SEED_COLOR,
	onPrimary: "#ffffff",
	primaryContainer: PlatformColor("tertiarySystemFill"),
	onPrimaryContainer: PlatformColor("label"),
	secondaryContainer: PlatformColor("secondarySystemFill"),
	onSecondaryContainer: PlatformColor("label"),
	tertiary: PlatformColor("systemOrange"),
	outline: PlatformColor("separator"),
	outlineVariant: PlatformColor("opaqueSeparator"),
	error: PlatformColor("systemRed"),
	errorContainer: PlatformColor("secondarySystemGroupedBackground"),
	onErrorContainer: PlatformColor("systemRed"),
};

export const usePalette = (): Palette => palette;
