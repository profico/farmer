import { Stack } from "expo-router";

import { EmptyState } from "../ui/components";
import { Screen } from "../ui/screen";

/**
 * A screen that is not built yet: its title in the header, and a line that
 * says so. Each route file starts as one of these, so that a screen can be
 * built in its own folder without a change to the navigation.
 */
export function Placeholder({ title }: { title: string }) {
	return (
		<>
			<Stack.Screen options={{ title }} />
			<Screen topInset={false}>
				<EmptyState
					icon="info"
					title={title}
					message="This screen is not in the app yet. Use Farmer on the web for now."
				/>
			</Screen>
		</>
	);
}
