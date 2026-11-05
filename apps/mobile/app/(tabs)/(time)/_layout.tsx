import { Stack } from "expo-router";

import {
	tabRootOptions,
	useStackOptions,
} from "../../../src/navigation/section-stack";

/** The Time tab. It has a stack of its own, so iOS can draw the large
 *  title in the navigation bar. */
export default function TimeLayout() {
	const options = useStackOptions();
	return (
		<Stack screenOptions={options}>
			<Stack.Screen name="index" options={tabRootOptions("Time")} />
		</Stack>
	);
}
