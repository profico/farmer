import type { ColorValue } from "react-native";
import { Platform } from "react-native";

import { iosPlainBackground } from "./ios-palette";
import { useTheme } from "./theme";

/**
 * The ground of a screen that is one plain list, with no cards. On iOS it is
 * `systemBackground`, which is white in light mode. Every other screen, and
 * Android, keep the screen colour of the theme.
 */
export const usePlainBackground = (): ColorValue => {
	const theme = useTheme();
	return Platform.OS === "ios"
		? iosPlainBackground(theme.scheme)
		: theme.palette.background;
};
