import { Stack, useLocalSearchParams } from "expo-router";

import { Chat } from "../../src/assistant/chat";
import { AssistantGate } from "../../src/assistant/gate";

/** One conversation. The chat itself is shared with the new-chat draft. */
export default function ConversationScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	return (
		<>
			{/* A title until the conversation sets its own. Without it, a
			    closed gate showed the name of the route file, "[id]". */}
			<Stack.Screen options={{ title: "Conversation" }} />
			<AssistantGate>
				<Chat id={id ?? ""} />
			</AssistantGate>
		</>
	);
}
