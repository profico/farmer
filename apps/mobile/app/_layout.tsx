import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { Platform } from "react-native";

import { DataProvider } from "../src/api/data-provider";
import { SessionProvider, useSession } from "../src/session/session";
import { usePalette } from "../src/ui/theme";

function Navigator() {
	const { state } = useSession();
	const palette = usePalette();

	useEffect(() => {
		void SystemUI.setBackgroundColorAsync(palette.background);
	}, [palette.background]);

	// Nothing is drawn until the stored session is read, so a signed-in
	// person never sees the Server screen flash past.
	if (state.status === "loading") return null;
	const signedIn = state.status === "signed_in";

	// The forms open as sheets on iOS and as full-screen dialogs on Android,
	// as each platform draws a form over a screen.
	const form = {
		presentation:
			Platform.OS === "ios" ? ("formSheet" as const) : ("modal" as const),
		sheetGrabberVisible: true,
		sheetAllowedDetents: [1],
		contentStyle: { backgroundColor: palette.surface },
	};

	return (
		<Stack
			screenOptions={{
				headerShown: false,
				contentStyle: { backgroundColor: palette.background },
			}}
		>
			<Stack.Protected guard={signedIn}>
				<Stack.Screen name="(tabs)" />
				{/* One stack for each group of screens; see the README. */}
				<Stack.Screen name="you" />
				<Stack.Screen name="workspace" />
				<Stack.Screen name="assistant" />
				<Stack.Screen name="entry" options={form} />
				<Stack.Screen name="start-timer" options={form} />
				<Stack.Screen name="stop-timer" options={form} />
			</Stack.Protected>
			<Stack.Protected guard={!signedIn}>
				<Stack.Screen name="server" />
				<Stack.Screen name="sign-in" />
			</Stack.Protected>
			<Stack.Screen name="connect" />
		</Stack>
	);
}

export default function RootLayout() {
	return (
		<SessionProvider>
			<DataProvider>
				<StatusBar style="auto" />
				<Navigator />
			</DataProvider>
		</SessionProvider>
	);
}
