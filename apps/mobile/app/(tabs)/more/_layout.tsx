import { Stack } from "expo-router";

import {
	tabRootOptions,
	useStackOptions,
} from "../../../src/navigation/section-stack";

/** The More tab. It has a stack of its own, so iOS can draw the large
 *  title in the navigation bar. */
export default function MoreLayout() {
	const options = useStackOptions();
	return (
		<Stack screenOptions={options}>
			<Stack.Screen name="index" options={tabRootOptions("More")} />
		</Stack>
	);
}
