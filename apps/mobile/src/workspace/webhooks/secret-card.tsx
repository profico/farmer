import { Platform, Pressable, Text as RNText, View } from "react-native";

import { ActionButton, Text } from "../../ui/components";
import { usePalette } from "../../ui/theme";
import { SPACE, TYPE } from "../../ui/type";
import { notify, notifyError } from "../components";
import { WorkspaceIcon } from "../icon";
import { copyText } from "../share";

/**
 * The signing secret of an endpoint, shown one time. The secret is only in
 * the answer of a create or a roll. The caller keeps it in component state
 * and drops it when the person presses "Done". It goes to no route
 * parameter, no query cache and no log.
 */
export function SecretCard({
	secret,
	note,
	onDone,
}: {
	secret: string;
	/** The line under the warning, such as the old secret's end of life. */
	note?: string;
	onDone: () => void;
}) {
	const palette = usePalette();
	const copy = () =>
		copyText(secret).then(
			() => notify("Secret copied"),
			(error: Error) => notifyError("Could not copy the secret", error),
		);
	return (
		<View
			style={{
				marginHorizontal: SPACE.l,
				padding: SPACE.l,
				gap: SPACE.m,
				borderRadius: Platform.OS === "ios" ? 10 : 16,
				backgroundColor: palette.surfaceContainer,
			}}
		>
			<Text variant="titleSmall" color={palette.primary}>
				Copy the secret
			</Text>
			<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
				Shown once. Use it to verify the Farmer-Signature header. If you lose
				it, roll the secret. The old one stays valid for 24 hours.
			</Text>
			{note ? (
				<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
					{note}
				</Text>
			) : null}
			<View
				style={{
					padding: SPACE.m,
					borderRadius: 8,
					backgroundColor: palette.surfaceContainerHigh,
				}}
			>
				<RNText
					selectable
					accessibilityLabel="Signing secret"
					style={[
						TYPE.bodyMedium,
						{
							color: palette.onSurface,
							fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
						},
					]}
				>
					{secret}
				</RNText>
			</View>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Copy the secret"
					onPress={() => void copy()}
					hitSlop={8}
					android_ripple={{ color: palette.outlineVariant }}
					style={({ pressed }) => ({
						flexDirection: "row",
						alignItems: "center",
						gap: SPACE.s,
						minHeight: 44,
						opacity: pressed ? 0.5 : 1,
					})}
				>
					<WorkspaceIcon name="copy" size={20} color={palette.primary} />
					<Text variant="labelLarge" color={palette.primary}>
						Copy
					</Text>
				</Pressable>
				<ActionButton label="Done" onPress={onDone} />
			</View>
		</View>
	);
}
