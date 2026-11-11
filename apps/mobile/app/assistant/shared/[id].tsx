import { Stack, useLocalSearchParams } from "expo-router";

import { AssistantGate } from "../../../src/assistant/gate";
import { SharedChat } from "../../../src/assistant/shared-chat";

/** A chat that its owner shared with the workspace. Read only. */
export default function SharedConversationScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	return (
		<>
			<Stack.Screen options={{ title: "Shared chat" }} />
			<AssistantGate>
				<SharedChat id={id ?? ""} />
			</AssistantGate>
		</>
	);
}
