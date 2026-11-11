import { Platform, Pressable, View } from "react-native";

import { Text } from "../ui/components";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";

/** The note shows from this share of the model's context. */
const NOTE_FROM = 0.7;

/** Tells the person that a long chat fills the model's memory. */
export function ContextNote({
	used,
	limit,
	onNewChat,
}: {
	used: number | null | undefined;
	limit: number | null | undefined;
	onNewChat: () => void;
}) {
	const palette = usePalette();
	if (!used || !limit || used / limit < NOTE_FROM) return null;
	const percent = Math.min(100, Math.round((used / limit) * 100));
	const android = Platform.OS === "android";
	return (
		<View
			accessibilityRole="alert"
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: SPACE.m,
				marginHorizontal: SPACE.l,
				marginBottom: SPACE.s,
				paddingHorizontal: android ? SPACE.l : 0,
				paddingVertical: android ? SPACE.s : 0,
				borderRadius: 16,
				// Material tonal container; iOS keeps plain secondary text.
				backgroundColor: android ? palette.secondaryContainer : undefined,
			}}
		>
			<View style={{ flex: 1 }}>
				<Text
					variant="bodySmall"
					color={
						android ? palette.onSecondaryContainer : palette.onSurfaceVariant
					}
				>
					This chat uses {percent}% of the model's memory. Start a new chat for
					best results.
				</Text>
			</View>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="New chat"
				onPress={onNewChat}
				hitSlop={SPACE.s}
			>
				<Text variant="labelLarge" color={palette.primary}>
					New chat
				</Text>
			</Pressable>
		</View>
	);
}
