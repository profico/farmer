import { Redirect, Stack, useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { Platform, PlatformColor, Pressable, Text } from "react-native";

import { useSignedIn } from "../session/session";
import { Icon } from "../ui/icon";
import { useMotionPreference } from "../ui/motion";
import { usePalette } from "../ui/theme";

type StackOptions = NonNullable<ComponentProps<typeof Stack>["screenOptions"]>;

/**
 * The back button of the first screen of a group on iOS. The group sits in
 * its own stack, so UIKit finds no screen behind it and draws no button.
 * Android draws one from the parent screen by itself.
 */
function GroupBackButton() {
	const router = useRouter();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel="Back"
			onPress={() => router.back()}
			hitSlop={8}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: 4,
				opacity: pressed ? 0.5 : 1,
			})}
		>
			<Icon name="back" size={20} color={PlatformColor("link")} />
			<Text style={{ fontSize: 17, color: PlatformColor("link") }}>Back</Text>
		</Pressable>
	);
}

/** The header of a pushed screen, in the theme of the app. */
export const useStackOptions = (): StackOptions => {
	const palette = usePalette();
	const { reduceMotion } = useMotionPreference();
	return ({ navigation, route }) => {
		const base = {
			animation: reduceMotion ? ("fade" as const) : ("default" as const),
			contentStyle: { backgroundColor: palette.background },
			headerStyle: { backgroundColor: palette.background },
			headerShadowVisible: false,
		};
		if (Platform.OS !== "ios") {
			return { ...base, headerTintColor: String(palette.onSurface) };
		}
		// iOS tints the back button with the accent by itself, and its
		// palette holds system colours that this prop cannot take.
		// Without a title colour, the title takes the light default of React
		// Navigation. The palette colour follows the light or dark mode of
		// the app; a system colour here is resolved by the header when it is
		// set, and then stays in the old mode.
		const title = { color: String(palette.onSurface) };
		// The first screen of a group has no screen behind it in its own
		// stack, but the screen of the parent stack does.
		const needsBack =
			navigation.getState().routes[0]?.key === route.key &&
			navigation.canGoBack();
		return {
			...base,
			headerTitleStyle: title,
			headerLargeTitleStyle: title,
			headerLeft: needsBack ? () => <GroupBackButton /> : undefined,
		};
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
