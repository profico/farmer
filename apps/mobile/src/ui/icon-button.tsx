import { Platform, Pressable } from "react-native";

import { Icon } from "./icon";
import type { IconName } from "./icons";
import { usePalette } from "./theme";

export type IconButtonProps = {
	icon: IconName;
	/** Read out by a screen reader. */
	label: string;
	onPress: () => void;
	disabled?: boolean;
	tone?: "plain" | "filled" | "tonal";
};

/**
 * A button with one icon, for a toolbar or a stepper. Android draws the
 * Material 3 Expressive button instead (`icon-button.android.tsx`). On iOS
 * a plain button is a bar button item: the symbol in the accent colour, with
 * no container. The tonal and the filled tones stay round, for a stepper.
 */
export function IconButton({
	icon,
	label,
	onPress,
	disabled,
	tone = "plain",
}: IconButtonProps) {
	const palette = usePalette();
	const backgroundColor =
		tone === "filled"
			? palette.primary
			: tone === "tonal"
				? palette.secondaryContainer
				: "transparent";
	const bar = Platform.OS === "ios" && tone === "plain";
	const color =
		tone === "filled"
			? palette.onPrimary
			: tone === "tonal"
				? palette.onSecondaryContainer
				: Platform.OS === "ios"
					? palette.primary
					: palette.onSurfaceVariant;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			disabled={disabled}
			hitSlop={4}
			android_ripple={{ color: palette.outlineVariant, borderless: true }}
			style={({ pressed }) => ({
				width: bar ? 44 : 40,
				height: bar ? 44 : 40,
				borderRadius: 20,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor,
				opacity: disabled ? 0.38 : Platform.OS === "ios" && pressed ? 0.5 : 1,
			})}
		>
			<Icon
				name={icon}
				size={bar ? 20 : 22}
				color={color}
				weight={bar ? "medium" : "regular"}
			/>
		</Pressable>
	);
}
