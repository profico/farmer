import { Redirect, Stack } from "expo-router";
import { Platform } from "react-native";

import { useStackOptions } from "../../src/navigation/section-stack";
import { useSignedIn } from "../../src/session/session";
import { usePalette } from "../../src/ui/theme";

/**
 * The stack of the "You" screens. It is `SectionStack` with the forms of
 * this folder declared, because a form must open as a sheet: a screen that
 * sets its presentation itself does so too late for its first transition.
 */
export default function YouLayout() {
	const { workspace } = useSignedIn();
	const options = useStackOptions();
	const palette = usePalette();
	if (!workspace) return <Redirect href="/" />;

	// The same sheet as the forms of the root stack: a sheet on iOS, a
	// full-screen dialog on Android.
	const form = {
		headerShown: Platform.OS === "ios",
		presentation:
			Platform.OS === "ios" ? ("formSheet" as const) : ("modal" as const),
		sheetGrabberVisible: true,
		sheetAllowedDetents: [1],
		contentStyle: { backgroundColor: palette.surface },
	};

	return (
		<Stack screenOptions={options}>
			<Stack.Screen name="recurring-block" options={form} />
			<Stack.Screen name="absence" options={form} />
			<Stack.Screen name="filing-rule" options={form} />
			<Stack.Screen
				name="rewind"
				options={{
					headerShown: false,
					presentation: "fullScreenModal",
					animation: "fade",
				}}
			/>
		</Stack>
	);
}
