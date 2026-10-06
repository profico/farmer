import { PlatformColor, Pressable, Text } from "react-native";

import type { DestructiveButtonProps } from "./destructive-button";
import { usePalette } from "./theme";

/** The red button of iOS for an action that deletes something: red text on
 *  a light red capsule, as the destructive role of a system button. */
export function DestructiveButton({
	label,
	onPress,
	disabled,
}: DestructiveButtonProps) {
	const palette = usePalette();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled }}
			onPress={onPress}
			disabled={disabled}
			style={({ pressed }) => ({
				minHeight: 44,
				paddingHorizontal: 20,
				borderRadius: 22,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: palette.errorContainer,
				opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
			})}
		>
			<Text
				style={{
					fontSize: 17,
					fontWeight: "600",
					color: PlatformColor("systemRed"),
				}}
			>
				{label}
			</Text>
		</Pressable>
	);
}
