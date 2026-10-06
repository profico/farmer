import { Stack } from "expo-router";

import {
	tabRootOptions,
	useStackOptions,
} from "../../../src/navigation/section-stack";

/** The Reports tab, and the entries behind a figure (`detail`). */
export default function ReportsLayout() {
	const options = useStackOptions();
	return (
		<Stack screenOptions={options}>
			<Stack.Screen name="index" options={tabRootOptions("Reports")} />
			<Stack.Screen name="detail" options={{ title: "" }} />
		</Stack>
	);
}
