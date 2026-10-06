import { useRef, useState } from "react";
import { Platform, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../ui/icon";
import { usePalette } from "../ui/theme";
import { SPACE, TYPE } from "../ui/type";

/** The server refuses a longer message. */
const MAX_LENGTH = 10_000;

/**
 * The field the person writes in, at the foot of the chat. It clears on
 * send and takes the text back when the message did not reach the server,
 * for example after a rate limit. While a turn runs, the button stops it.
 */
export function Composer({
	onSend,
	onStop,
	streaming,
	locked,
	keyboardOpen,
	placeholder,
	autoFocus = false,
}: {
	/** True when the message reached the server. */
	onSend: (text: string) => Promise<boolean>;
	onStop: () => void;
	streaming: boolean;
	/** An approval waits: the card is the way to answer it. */
	locked: boolean;
	/** The keyboard covers the home indicator, so the inset goes. */
	keyboardOpen: boolean;
	placeholder: string;
	/** Open the keyboard at once, for a new chat. */
	autoFocus?: boolean;
}) {
	const palette = usePalette();
	const insets = useSafeAreaInsets();
	const [text, setText] = useState("");
	const input = useRef<TextInput>(null);
	const canSend = text.trim() !== "" && !streaming && !locked;

	const send = async () => {
		const message = text.trim();
		if (!message || streaming || locked) return;
		setText("");
		const landed = await onSend(message);
		if (!landed) {
			setText((current) => (current === "" ? message : current));
			input.current?.focus();
		}
	};

	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "flex-end",
				gap: SPACE.s,
				paddingHorizontal: SPACE.m,
				paddingTop: SPACE.s,
				paddingBottom:
					(keyboardOpen ? SPACE.s : Math.max(insets.bottom, SPACE.s)) +
					SPACE.xs,
				backgroundColor: palette.background,
				borderTopWidth: Platform.OS === "ios" ? 0.5 : 0,
				borderTopColor: palette.outlineVariant,
			}}
		>
			<TextInput
				ref={input}
				value={text}
				onChangeText={setText}
				placeholder={locked ? "Answer the approval first" : placeholder}
				placeholderTextColor={palette.onSurfaceVariant}
				selectionColor={palette.primary}
				cursorColor={palette.primary}
				editable={!locked}
				autoFocus={autoFocus}
				multiline
				maxLength={MAX_LENGTH}
				accessibilityLabel="Message"
				style={[
					TYPE.bodyLarge,
					{
						flex: 1,
						minHeight: 44,
						maxHeight: 160,
						paddingHorizontal: SPACE.l,
						paddingTop: Platform.OS === "ios" ? 11 : SPACE.s,
						paddingBottom: Platform.OS === "ios" ? 11 : SPACE.s,
						borderRadius: 22,
						color: palette.onSurface,
						backgroundColor: palette.surfaceContainerHigh,
						textAlignVertical: "center",
					},
				]}
			/>
			{streaming ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Stop the answer"
					onPress={onStop}
					hitSlop={6}
					style={({ pressed }) => ({
						width: 44,
						height: 44,
						borderRadius: 22,
						alignItems: "center",
						justifyContent: "center",
						backgroundColor: palette.secondaryContainer,
						opacity: pressed ? 0.7 : 1,
					})}
				>
					<Icon name="stop" size={20} color={palette.onSecondaryContainer} />
				</Pressable>
			) : (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Send"
					accessibilityState={{ disabled: !canSend }}
					disabled={!canSend}
					onPress={() => void send()}
					hitSlop={6}
					style={({ pressed }) => ({
						width: 44,
						height: 44,
						borderRadius: 22,
						alignItems: "center",
						justifyContent: "center",
						backgroundColor: canSend
							? palette.primary
							: palette.surfaceContainerHigh,
						opacity: pressed ? 0.7 : 1,
					})}
				>
					<Icon
						name="send"
						size={22}
						color={canSend ? palette.onPrimary : palette.onSurfaceVariant}
					/>
				</Pressable>
			)}
		</View>
	);
}
