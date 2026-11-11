import { ScrollView, View } from "react-native";

import { useSharedThread } from "../api/assistant";
import { ErrorState, Skeleton, Text } from "../ui/components";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import { Answer } from "./answer";
import { UserMessage } from "./user-message";

/**
 * A chat that its owner shared, as a transcript with a banner. It has no
 * composer, no approval card and no undo. The banner says that the chat can
 * show data that the reader cannot normally see.
 */
export function SharedChat({ id }: { id: string }) {
	const palette = usePalette();
	const shared = useSharedThread(id);
	if (shared.isPending) {
		return (
			<View style={{ padding: SPACE.l, gap: SPACE.m }}>
				<Skeleton height={48} width="60%" />
				<Skeleton height={120} />
			</View>
		);
	}
	if (shared.error) {
		return (
			<ErrorState error={shared.error} onRetry={() => void shared.refetch()} />
		);
	}
	const { sharedBy, sharedAt, messages, thread } = shared.data;
	const when = new Date(sharedAt).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
	return (
		<ScrollView
			contentContainerStyle={{ padding: SPACE.l, gap: SPACE.xl }}
			contentInsetAdjustmentBehavior="automatic"
		>
			<View
				style={{
					borderRadius: 16,
					padding: SPACE.l,
					backgroundColor: palette.surfaceContainerHigh,
				}}
			>
				<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
					Shared by {sharedBy.name} on {when}. It can show data that you cannot
					normally see.
				</Text>
			</View>
			<Text variant="titleMedium">{thread.title}</Text>
			{messages.map((message) => {
				if (message.role === "user") {
					return <UserMessage key={message.id} text={message.content} />;
				}
				if (message.role === "assistant" && message.content.trim()) {
					return <Answer key={message.id} text={message.content} />;
				}
				return null;
			})}
		</ScrollView>
	);
}
