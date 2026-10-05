import {
	isDynamicColorAvailable,
	useMaterialColors,
} from "@expo/ui/jetpack-compose";
import { useColorScheme } from "react-native";

import { type Palette, SEED_COLOR } from "./palette";

/**
 * Material You: the wallpaper's colours on Android 12 and later. The farmer
 * accent seeds the palette only where the phone has none, because a seed
 * replaces the wallpaper's colours.
 */
export const usePalette = (): Palette => {
	const colorScheme = useColorScheme();
	const colors = useMaterialColors({
		colorScheme,
		seedColor: isDynamicColorAvailable ? undefined : SEED_COLOR,
	});
	return {
		background: colors.background,
		surface: colors.surface,
		surfaceContainer: colors.surfaceContainer,
		surfaceContainerHigh: colors.surfaceContainerHigh,
		onSurface: colors.onSurface,
		onSurfaceVariant: colors.onSurfaceVariant,
		primary: colors.primary,
		onPrimary: colors.onPrimary,
		primaryContainer: colors.primaryContainer,
		onPrimaryContainer: colors.onPrimaryContainer,
		secondaryContainer: colors.secondaryContainer,
		onSecondaryContainer: colors.onSecondaryContainer,
		tertiary: colors.tertiary,
		outline: colors.outline,
		outlineVariant: colors.outlineVariant,
		error: colors.error,
		errorContainer: colors.errorContainer,
		onErrorContainer: colors.onErrorContainer,
	};
};
