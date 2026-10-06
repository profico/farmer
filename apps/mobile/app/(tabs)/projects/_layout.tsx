import { Stack } from "expo-router";
import { Platform } from "react-native";

import {
	tabRootOptions,
	useStackOptions,
} from "../../../src/navigation/section-stack";

/** The Projects tab, a project, its settings, team and GitHub
 *  repositories, and a new project. */
export default function ProjectsLayout() {
	const options = useStackOptions();
	// The list has no title of its own, so iOS would read its route name
	// ("index") on the back button of the screens above it.
	const headerBackTitle = Platform.OS === "ios" ? "Projects" : undefined;
	return (
		<Stack screenOptions={options}>
			<Stack.Screen name="index" options={tabRootOptions("Projects")} />
			<Stack.Screen
				name="[id]/index"
				options={{ title: "", headerBackTitle }}
			/>
			<Stack.Screen name="[id]/settings" options={{ title: "Settings" }} />
			<Stack.Screen name="[id]/team" options={{ title: "Team" }} />
			<Stack.Screen name="[id]/repositories" options={{ title: "GitHub" }} />
			<Stack.Screen
				name="new"
				options={{ title: "New project", headerBackTitle }}
			/>
		</Stack>
	);
}
