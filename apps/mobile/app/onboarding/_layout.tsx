import { Stack } from "expo-router";

import { useStackOptions } from "../../src/navigation/section-stack";

/**
 * The stack of the invitations and the Harvest claims that wait for the
 * person (`index`), from More. Unlike `SectionStack`, it does not send a
 * person without a workspace to the tabs. The new workspace form is in
 * the root stack (`app/new-workspace.tsx`), because the tabs and the
 * screen of a person without a workspace open it directly, and only a
 * screen of the root stack opens as a sheet from there.
 */
export default function OnboardingLayout() {
	const options = useStackOptions();
	return (
		<Stack screenOptions={options}>
			<Stack.Screen name="index" options={{ title: "Invitations" }} />
		</Stack>
	);
}
