import { Redirect, Stack } from "expo-router";
import { Platform } from "react-native";

import {
	useFormOptions,
	useStackOptions,
} from "../../src/navigation/section-stack";
import { useSignedIn } from "../../src/session/session";

/**
 * The stack of the "You" screens. It is `SectionStack` with the forms of
 * this folder declared, because a form must open as a sheet: a screen that
 * sets its presentation itself does so too late for its first transition.
 */
export default function YouLayout() {
	const { workspace } = useSignedIn();
	const options = useStackOptions();
	const form = useFormOptions({ headerShown: Platform.OS === "ios" });
	if (!workspace) return <Redirect href="/" />;

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
