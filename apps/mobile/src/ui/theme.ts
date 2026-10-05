import { useColorScheme } from "react-native";

import type { Palette } from "./palette";

// The Material 3 baseline from the farmer seed. Android and iOS have their
// own files (`theme.android.ts`, `theme.ios.ts`); this one is the fallback.
const light: Palette = {
	background: "#fef7ff",
	surface: "#fef7ff",
	surfaceContainer: "#f3edf7",
	surfaceContainerHigh: "#ece6f0",
	onSurface: "#1d1b20",
	onSurfaceVariant: "#49454f",
	primary: "#6f4ebe",
	onPrimary: "#ffffff",
	primaryContainer: "#eaddff",
	onPrimaryContainer: "#25005a",
	secondaryContainer: "#e8def8",
	onSecondaryContainer: "#1d192b",
	tertiary: "#7d5260",
	outline: "#79747e",
	outlineVariant: "#cac4d0",
	error: "#b3261e",
	errorContainer: "#f9dedc",
	onErrorContainer: "#410e0b",
};

const dark: Palette = {
	background: "#141218",
	surface: "#141218",
	surfaceContainer: "#211f26",
	surfaceContainerHigh: "#2b2930",
	onSurface: "#e6e0e9",
	onSurfaceVariant: "#cac4d0",
	primary: "#d0bcff",
	onPrimary: "#381e72",
	primaryContainer: "#4f378b",
	onPrimaryContainer: "#eaddff",
	secondaryContainer: "#4a4458",
	onSecondaryContainer: "#e8def8",
	tertiary: "#efb8c8",
	outline: "#938f99",
	outlineVariant: "#49454f",
	error: "#f2b8b5",
	errorContainer: "#8c1d18",
	onErrorContainer: "#f9dedc",
};

export const usePalette = (): Palette =>
	useColorScheme() === "dark" ? dark : light;
