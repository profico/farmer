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

/** A round button with one icon, for a toolbar or a stepper. Android draws
 *  the Material 3 Expressive button instead (`icon-button.android.tsx`). */
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
	const color =
		tone === "filled"
			? palette.onPrimary
			: tone === "tonal"
				? palette.onSecondaryContainer
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
				width: 40,
				height: 40,
				borderRadius: 20,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor,
				opacity: disabled ? 0.38 : Platform.OS === "ios" && pressed ? 0.5 : 1,
			})}
		>
			<Icon name={icon} size={22} color={color} />
		</Pressable>
	);
}
