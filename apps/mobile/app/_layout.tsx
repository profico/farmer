import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";

import { DataProvider } from "../src/api/data-provider";
import { useFormOptions } from "../src/navigation/section-stack";
import { useSystemBack } from "../src/navigation/system-back";
import { PushBridge } from "../src/push/push-bridge";
import { SessionProvider, useSession } from "../src/session/session";
import { DialogHost } from "../src/ui/dialog-host";
import { reapplyScheme } from "../src/ui/display-prefs";
import { useMotionPreference } from "../src/ui/motion";
import { RowMenuProvider } from "../src/ui/row-menu";
import { usePalette } from "../src/ui/theme";

function Navigator() {
	const { state } = useSession();
	const palette = usePalette();
	const { reduceMotion } = useMotionPreference();
	useSystemBack();
	const form = useFormOptions();

	// The window behind every screen follows the theme, so a transition
	// never shows a colour from another theme behind a screen.
	useEffect(() => {
		void SystemUI.setBackgroundColorAsync(palette.background);
	}, [palette.background]);

	// A new activity starts in the night mode of the config. The chosen
	// light or dark mode goes back to the native side here.
	useEffect(reapplyScheme, []);

	// Nothing is drawn until the stored session is read, so a signed-in
	// person never sees the Server screen flash past.
	if (state.status === "loading") return null;
	const signedIn = state.status === "signed_in";

	return (
		<Stack
			screenOptions={{
				headerShown: false,
				contentStyle: { backgroundColor: palette.background },
				// Less motion: a screen fades in, and nothing slides.
				animation: reduceMotion ? "fade" : "default",
			}}
		>
			<Stack.Protected guard={signedIn}>
				<Stack.Screen name="(tabs)" />
				{/* One stack for each group of screens; see the README. */}
				<Stack.Screen name="you" />
				<Stack.Screen name="workspace" />
				<Stack.Screen name="assistant" />
				<Stack.Screen name="onboarding" />
				<Stack.Screen name="entry" options={form} />
				<Stack.Screen name="start-timer" options={form} />
				<Stack.Screen name="stop-timer" options={form} />
				<Stack.Screen name="time" options={form} />
				<Stack.Screen name="new-workspace" options={form} />
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
				<PushBridge />
				<RowMenuProvider>
					<Navigator />
				</RowMenuProvider>
				<DialogHost />
			</DataProvider>
		</SessionProvider>
	);
}
