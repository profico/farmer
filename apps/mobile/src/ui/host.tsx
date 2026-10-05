import { Host } from "@expo/ui";
import type { ReactNode } from "react";

import { useTheme } from "./theme";

/**
 * The bridge to the native toolkit for one `@expo/ui` control, in the theme
 * in force. On Android the seed gives the Compose palette; with Material You
 * on there is no seed and Compose takes the wallpaper's colours. On iOS the
 * seed is the SwiftUI tint.
 */
export function ControlHost({ children }: { children: ReactNode }) {
	const theme = useTheme();
	return (
		<Host matchContents colorScheme={theme.scheme} seedColor={theme.seedColor}>
			{children}
		</Host>
	);
}

/** The colour props for a platform `Host` (`@expo/ui/swift-ui` or
 *  `@expo/ui/jetpack-compose`), so its controls follow the theme in force. */
export const useHostTheme = () => {
	const theme = useTheme();
	return { colorScheme: theme.scheme, seedColor: theme.seedColor };
};
