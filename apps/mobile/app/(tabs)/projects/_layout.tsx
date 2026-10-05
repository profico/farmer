import { Stack } from "expo-router";

import { useStackOptions } from "../../../src/navigation/section-stack";

/** The Projects tab, a project, its settings and team, and a new
 *  project. */
export default function ProjectsLayout() {
	const options = useStackOptions();
	return (
		<Stack screenOptions={options}>
			<Stack.Screen name="index" options={{ headerShown: false }} />
			<Stack.Screen name="[id]/index" options={{ title: "" }} />
			<Stack.Screen name="[id]/settings" options={{ title: "Settings" }} />
			<Stack.Screen name="[id]/team" options={{ title: "Team" }} />
			<Stack.Screen name="new" options={{ title: "New project" }} />
		</Stack>
	);
}
