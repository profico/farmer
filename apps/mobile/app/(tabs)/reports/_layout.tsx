import { Stack } from "expo-router";

import { useStackOptions } from "../../../src/navigation/section-stack";

/** The Reports tab, and the entries behind a figure (`detail`). */
export default function ReportsLayout() {
	const options = useStackOptions();
	return (
		<Stack screenOptions={options}>
			<Stack.Screen name="index" options={{ headerShown: false }} />
			<Stack.Screen name="detail" options={{ title: "" }} />
		</Stack>
	);
}
