import { Redirect, Stack } from "expo-router";
import { Platform } from "react-native";

import { useSignedIn } from "../session/session";
import { usePalette } from "../ui/theme";

/** The header of a pushed screen, in the theme of the app. */
export const useStackOptions = () => {
	const palette = usePalette();
	return {
		contentStyle: { backgroundColor: palette.background },
		headerStyle: { backgroundColor: palette.background },
		// iOS tints the back button with the accent by itself, and its
		// palette holds system colours that this prop cannot take.
		headerTintColor:
			Platform.OS === "android" ? String(palette.onSurface) : undefined,
		headerShadowVisible: false,
	};
};

/**
 * The stack of one group of screens (`app/you`, `app/workspace`,
 * `app/assistant`). Each screen sets its own title with `<Stack.Screen>`,
 * so a new screen in the folder needs no change here.
 *
 * These stacks sit above the tabs, which choose the workspace. A link that
 * opens one first finds no workspace yet, so it goes to the tabs.
 */
export function SectionStack() {
	const { workspace } = useSignedIn();
	const options = useStackOptions();
	if (!workspace) return <Redirect href="/" />;
	return <Stack screenOptions={options} />;
}
