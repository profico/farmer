import { Pressable, Text as RNText, View } from "react-native";
import Animated from "react-native-reanimated";

import type { ActionButtonProps } from "./action-button";
import { evenCorners, useCornerMorph } from "./press-morph";
import { usePalette } from "./theme";
import { verticalSlop } from "./touch-target";
import { TYPE } from "./type";

// The Material 3 Expressive button, drawn in React Native. The Compose
// `Button` of `@expo/ui` has a `shape`, but it has no press event, so it
// cannot morph its corners while a finger holds it. iOS keeps the system
// button (`action-button.tsx`).

/** The small button of the Material 3 Expressive specification: the height,
 *  the side padding, the label and the pressed corner. */
const SPEC = { height: 40, padding: 16, label: TYPE.labelLarge, pressed: 8 };

/** The touch target is 48dp high, as the drawn button is 40dp. */
const SLOP = verticalSlop(SPEC.height);

export function ActionButton({
	label,
	onPress,
	variant = "filled",
	tone = "default",
	disabled,
}: ActionButtonProps) {
	const palette = usePalette();
	const spec = SPEC;
	const morph = useCornerMorph(evenCorners(spec.height / 2), spec.pressed);
	// Material 3 draws a disabled button in the on-surface colour: the
	// container at 12% and the label at 38%. A fade of the whole button kept
	// the label in its own tone, so it was hard to read on some themes.
	const filledLike =
		variant === "filled" || variant === "tonal" || variant === "elevated";
	const container = disabled
		? filledLike
			? palette.disabledContainer
			: "transparent"
		: variant === "filled"
			? palette.primary
			: variant === "tonal"
				? palette.secondaryContainer
				: variant === "elevated"
					? palette.surfaceContainerLow
					: "transparent";
	const content = disabled
		? palette.onDisabled
		: variant === "filled"
			? palette.onPrimary
			: variant === "tonal"
				? palette.onSecondaryContainer
				: tone === "error"
					? palette.error
					: palette.primary;
	return (
		// A row keeps the button as wide as its label in a column, as the
		// system button is. A centered or row parent still places it.
		<View style={{ flexDirection: "row" }} hitSlop={SLOP}>
			<Animated.View
				hitSlop={SLOP}
				style={[
					{
						height: spec.height,
						overflow: "hidden",
						backgroundColor: container,
						borderWidth: variant === "outlined" ? 1 : 0,
						borderColor: disabled ? palette.disabledContainer : palette.outline,
						elevation: variant === "elevated" && !disabled ? 1 : 0,
					},
					morph.style,
				]}
			>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={label}
					accessibilityState={{ disabled: Boolean(disabled) }}
					disabled={disabled}
					hitSlop={SLOP}
					onPress={onPress}
					onPressIn={morph.onPressIn}
					onPressOut={morph.onPressOut}
					android_ripple={{ color: palette.outlineVariant }}
					style={{
						flex: 1,
						alignItems: "center",
						justifyContent: "center",
						paddingHorizontal: spec.padding,
					}}
				>
					<RNText numberOfLines={1} style={[spec.label, { color: content }]}>
						{label}
					</RNText>
				</Pressable>
			</Animated.View>
		</View>
	);
}
