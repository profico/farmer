import { Stack } from "expo-router";
import { Platform } from "react-native";

import { usePalette } from "../../../src/ui/theme";

export default function ProjectsLayout() {
	const palette = usePalette();
	return (
		<Stack
			screenOptions={{
				contentStyle: { backgroundColor: palette.background },
				headerStyle: { backgroundColor: palette.background },
				// iOS tints the back button with the accent by itself, and its
				// palette holds system colours that this prop cannot take.
				headerTintColor:
					Platform.OS === "android" ? String(palette.onSurface) : undefined,
				headerShadowVisible: false,
			}}
		>
			<Stack.Screen name="index" options={{ headerShown: false }} />
			<Stack.Screen name="[id]" options={{ title: "" }} />
		</Stack>
	);
}
