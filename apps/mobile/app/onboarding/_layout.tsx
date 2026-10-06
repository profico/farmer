import { Stack } from "expo-router";
import { Platform } from "react-native";

import { useStackOptions } from "../../src/navigation/section-stack";
import { usePalette } from "../../src/ui/theme";

/**
 * The stack of the screens of a person before a workspace: the
 * invitations and the claims that wait (`index`) and a new workspace.
 * Unlike `SectionStack`, it does not send a person without a workspace to
 * the tabs: the screen in place of the tabs opens the new workspace form
 * from here.
 */
export default function OnboardingLayout() {
	const options = useStackOptions();
	const palette = usePalette();
	const form = {
		headerShown: false,
		presentation:
			Platform.OS === "ios" ? ("formSheet" as const) : ("modal" as const),
		sheetGrabberVisible: true,
		sheetAllowedDetents: [1],
		contentStyle: { backgroundColor: palette.surface },
	};
	return (
		<Stack screenOptions={options}>
			<Stack.Screen name="index" options={{ title: "Invitations" }} />
			<Stack.Screen name="new-workspace" options={form} />
		</Stack>
	);
}
