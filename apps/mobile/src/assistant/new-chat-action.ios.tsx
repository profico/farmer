import { Stack } from "expo-router";

/** The space below the last chat that the toolbar takes: none, as the
 *  system insets the list above its bottom toolbar. */
export const NEW_CHAT_CLEARANCE = 0;

/**
 * "New chat" as the compose button at the bottom right of the toolbar, as
 * Notes and Mail draw it. The system draws the glass. Android draws an
 * extended FAB instead (`new-chat-action.tsx`).
 */
export function NewChatAction({ onPress }: { onPress: () => void }) {
	return (
		<Stack.Toolbar>
			<Stack.Toolbar.Spacer />
			<Stack.Toolbar.Button
				icon="square.and.pencil"
				accessibilityLabel="New chat"
				onPress={onPress}
			/>
		</Stack.Toolbar>
	);
}
