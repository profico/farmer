import { Stack } from "expo-router";

import { Chat } from "../../src/assistant/chat";
import { AssistantGate } from "../../src/assistant/gate";

/**
 * A chat that has no thread yet, as on the web. Nothing reaches the server
 * until the first message, so a person who leaves makes no empty thread.
 */
export default function NewChatScreen() {
	return (
		<>
			<Stack.Screen options={{ title: "New chat" }} />
			<AssistantGate>
				<Chat id={null} />
			</AssistantGate>
		</>
	);
}
