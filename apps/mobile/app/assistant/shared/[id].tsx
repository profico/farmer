import { Stack, useLocalSearchParams } from "expo-router";

import { useWorkspace } from "../../../src/api/queries";
import { AssistantGate } from "../../../src/assistant/gate";
import { SharedChat } from "../../../src/assistant/shared-chat";
import { otherWorkspace } from "../../../src/assistant/shared-target";
import { EmptyState } from "../../../src/ui/components";

/** A chat that its owner shared with the workspace. Read only. */
function SharedChatOrMismatch({ id }: { id: string }) {
	const { org, server } = useLocalSearchParams<{
		org?: string;
		server?: string;
	}>();
	const w = useWorkspace();
	const other = otherWorkspace({ org, server }, w);
	if (!other) return <SharedChat id={id} />;
	return (
		<EmptyState
			icon="error"
			tone="error"
			title="This chat is in another workspace."
			message={`Switch to ${other.org} on ${other.server}, then open the link again.`}
		/>
	);
}

export default function SharedConversationScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	return (
		<>
			<Stack.Screen options={{ title: "Shared chat" }} />
			<AssistantGate>
				<SharedChatOrMismatch id={id ?? ""} />
			</AssistantGate>
		</>
	);
}
