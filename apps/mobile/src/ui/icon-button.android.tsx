import { Pressable } from "react-native";
import Animated from "react-native-reanimated";

import { Icon } from "./icon";
import type { IconButtonProps } from "./icon-button";
import { evenCorners, useCornerMorph } from "./press-morph";
import { usePalette } from "./theme";

/**
 * The Material 3 Expressive icon button: 40dp, round at rest, and the
 * corners move toward a square while a finger holds it. The touch target is
 * 48dp. The negative margin keeps the layout size at 40dp.
 */
export function IconButton({
	icon,
	label,
	onPress,
	disabled,
	tone = "plain",
}: IconButtonProps) {
	const palette = usePalette();
	const morph = useCornerMorph(evenCorners(20), 12);
	// The disabled colours of Material 3, as in `action-button.android.tsx`.
	const backgroundColor = disabled
		? tone === "plain"
			? "transparent"
			: palette.disabledContainer
		: tone === "filled"
			? palette.primary
			: tone === "tonal"
				? palette.secondaryContainer
				: "transparent";
	const color = disabled
		? palette.onDisabled
		: tone === "filled"
			? palette.onPrimary
			: tone === "tonal"
				? palette.onSecondaryContainer
				: palette.onSurfaceVariant;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled: Boolean(disabled) }}
			onPress={onPress}
			onPressIn={morph.onPressIn}
			onPressOut={morph.onPressOut}
			disabled={disabled}
			android_ripple={{ color: palette.outlineVariant, borderless: true }}
			style={{
				width: 48,
				height: 48,
				margin: -4,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Animated.View
				style={[
					{
						width: 40,
						height: 40,
						alignItems: "center",
						justifyContent: "center",
						backgroundColor,
					},
					morph.style,
				]}
			>
				<Icon name={icon} size={24} color={color} />
			</Animated.View>
		</Pressable>
	);
}
