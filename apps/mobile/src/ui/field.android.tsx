import { useContext, useEffect, useRef, useState } from "react";
import { Pressable, Text as RNText, TextInput, View } from "react-native";
import Animated, {
	interpolate,
	useAnimatedStyle,
	useSharedValue,
	withSpring,
	withTiming,
} from "react-native-reanimated";

import { RADIUS } from "./corner";
import type { FieldProps } from "./field";
import { springOrFade, useMotionPreference } from "./motion";
import { SurfaceColor } from "./surface-color";
import { usePalette } from "./theme";
import { SPACE, TYPE } from "./type";

// The outlined text field of Material 3, drawn in React Native so that each
// prop of `TextInput` keeps working (the Compose field keeps its text on
// the native side). The look is the same as `OutlinedTextField` in
// `menu-control.android.tsx`: a 56dp box, a 4dp corner, and a label that
// moves up onto the outline when the field has focus or text.

const HEIGHT = 56;
const LINE = 24;
const SIDE = SPACE.l;
/** How far the label moves up, from the middle of the box to the outline. */
const LIFT = HEIGHT / 2;

/**
 * The outlined text field of Material 3, with a floating label.
 */
export function Field({
	label,
	hint,
	error,
	containerColor,
	onFocus,
	onBlur,
	onChangeText,
	...input
}: FieldProps) {
	const palette = usePalette();
	const surface = useContext(SurfaceColor);
	const { reduceMotion } = useMotionPreference();
	const [focused, setFocused] = useState(false);
	const [typed, setTyped] = useState(Boolean(input.defaultValue));
	const filled = input.value === undefined ? typed : input.value.length > 0;
	const floated = focused || filled;
	const inputRef = useRef<TextInput>(null);
	const float = useSharedValue(floated ? 1 : 0);
	const disabled = input.editable === false;
	const multiline = Boolean(input.multiline);

	useEffect(() => {
		const choice = springOrFade("fastSpatial", reduceMotion);
		float.set(
			choice.reduced
				? withTiming(floated ? 1 : 0, { duration: choice.fadeMs })
				: withSpring(floated ? 1 : 0, choice.spring),
		);
	}, [floated, reduceMotion, float]);

	const labelStyle = useAnimatedStyle(() => ({
		transform: [
			{ translateY: interpolate(float.value, [0, 1], [0, -LIFT]) },
			{ scale: interpolate(float.value, [0, 1], [1, 0.75]) },
		],
	}));

	const accent = error
		? palette.error
		: focused
			? palette.primary
			: palette.onSurfaceVariant;
	return (
		<View style={{ gap: SPACE.xs, opacity: disabled ? 0.38 : 1 }}>
			<View style={{ paddingTop: SPACE.s }}>
				<Pressable
					accessible={false}
					onPress={() => inputRef.current?.focus()}
					style={{
						minHeight: multiline ? HEIGHT * 2 : HEIGHT,
						borderRadius: RADIUS.field,
						borderWidth: focused || error ? 2 : 1,
						borderColor: error
							? palette.error
							: focused
								? palette.primary
								: palette.outline,
					}}
				>
					<TextInput
						ref={inputRef}
						accessibilityLabel={label}
						placeholderTextColor={palette.onSurfaceVariant}
						selectionColor={palette.primary}
						cursorColor={error ? palette.error : palette.primary}
						{...input}
						placeholder={floated ? input.placeholder : undefined}
						onFocus={(event) => {
							setFocused(true);
							onFocus?.(event);
						}}
						onBlur={(event) => {
							setFocused(false);
							onBlur?.(event);
						}}
						onChangeText={(text) => {
							setTyped(text.length > 0);
							onChangeText?.(text);
						}}
						style={[
							TYPE.bodyLarge,
							{
								color: palette.onSurface,
								// The border is 1dp or 2dp, so the padding is the
								// rest of the side space.
								paddingHorizontal: SIDE - (focused || error ? 2 : 1),
								paddingVertical: multiline ? SPACE.l : 0,
								minHeight: multiline ? HEIGHT * 2 - 2 : HEIGHT - 2,
								textAlignVertical: multiline ? "top" : "center",
							},
						]}
					/>
				</Pressable>
				<View
					// The label sits over the box. A touch goes to the input.
					pointerEvents="none"
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
					style={{
						position: "absolute",
						left: SIDE - SPACE.xs,
						top: SPACE.s + (multiline ? SPACE.l : (HEIGHT - LINE) / 2),
					}}
				>
					<Animated.View
						style={[
							{
								transformOrigin: "left center",
								paddingHorizontal: SPACE.xs,
								backgroundColor:
									containerColor ?? surface ?? palette.background,
							},
							labelStyle,
						]}
					>
						<RNText
							numberOfLines={1}
							style={[TYPE.bodyLarge, { color: accent }]}
						>
							{label}
						</RNText>
					</Animated.View>
				</View>
			</View>
			{error || hint ? (
				<View style={{ paddingHorizontal: SIDE }}>
					<RNText
						style={[
							TYPE.bodySmall,
							{ color: error ? palette.error : palette.onSurfaceVariant },
						]}
					>
						{error ?? hint}
					</RNText>
				</View>
			) : null}
		</View>
	);
}
