import { Stack } from "expo-router";

import { useStackOptions } from "../../../src/navigation/section-stack";

export default function ProjectsLayout() {
	const options = useStackOptions();
	return (
		<Stack screenOptions={options}>
			<Stack.Screen name="index" options={{ headerShown: false }} />
			<Stack.Screen name="[id]/index" options={{ title: "" }} />
		</Stack>
	);
}
