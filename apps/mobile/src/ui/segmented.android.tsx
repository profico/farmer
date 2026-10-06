import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, {
	interpolate,
	useAnimatedStyle,
	useSharedValue,
	withSpring,
	withTiming,
} from "react-native-reanimated";

import { Text } from "./components";
import { CORNER } from "./corner";
import { springOrFade, useMotionPreference } from "./motion";
import type { SegmentedControlProps } from "./segmented";
import { usePalette } from "./theme";
import { verticalSlop } from "./touch-target";

const HEIGHT = 40;
const FULL = HEIGHT / 2;
/** The touch target is 48dp high, as the drawn button is 40dp. */
const SLOP = verticalSlop(HEIGHT);

/**
 * The Material 3 Expressive connected button group. Each option is its own
 * toggle button, 2dp apart. The outer corners of the group are full and the
 * corners between two buttons are small. The selected button is full on all
 * four corners. The corners move with a spring when the choice changes.
 *
 * `@expo/ui` has a Compose `ToggleButton`, but it has no `shape`, so the
 * buttons are drawn in React Native from the corner tokens.
 */
export function SegmentedControl<T extends string>({
	options,
	value,
	onChange,
}: SegmentedControlProps<T>) {
	return (
		<View
			accessibilityRole="tablist"
			hitSlop={SLOP}
			style={{ flexDirection: "row", gap: 2, alignSelf: "stretch" }}
		>
			{options.map((option, index) => (
				<Segment
					key={option.value}
					label={option.label}
					selected={option.value === value}
					first={index === 0}
					last={index === options.length - 1}
					onPress={() => onChange(option.value)}
				/>
			))}
		</View>
	);
}

function Segment({
	label,
	selected,
	first,
	last,
	onPress,
}: {
	label: string;
	selected: boolean;
	first: boolean;
	last: boolean;
	onPress: () => void;
}) {
	const palette = usePalette();
	const { reduceMotion } = useMotionPreference();
	const chosen = useSharedValue(selected ? 1 : 0);
	const pressed = useSharedValue(0);
	useEffect(() => {
		const choice = springOrFade("fastSpatial", reduceMotion);
		chosen.set(
			choice.reduced
				? withTiming(selected ? 1 : 0, { duration: choice.fadeMs })
				: withSpring(selected ? 1 : 0, choice.spring),
		);
	}, [selected, reduceMotion, chosen]);
	const style = useAnimatedStyle(() => {
		// A spring may overshoot, and a radius cannot be below zero.
		const corner = (rest: number) => {
			const resting = interpolate(chosen.value, [0, 1], [rest, FULL]);
			// A press makes an inner corner smaller still.
			const pressedTo = rest === FULL ? FULL : CORNER.extraSmall;
			return Math.max(
				0,
				interpolate(pressed.value, [0, 1], [resting, pressedTo]),
			);
		};
		const left = first ? FULL : CORNER.small;
		const right = last ? FULL : CORNER.small;
		return {
			borderTopLeftRadius: corner(left),
			borderBottomLeftRadius: corner(left),
			borderTopRightRadius: corner(right),
			borderBottomRightRadius: corner(right),
		};
	}, [first, last]);
	const press = (to: number) => {
		const choice = springOrFade("fastSpatial", reduceMotion);
		if (!choice.reduced) pressed.set(withSpring(to, choice.spring));
	};
	return (
		<Animated.View
			hitSlop={SLOP}
			style={[
				{
					flex: 1,
					height: HEIGHT,
					overflow: "hidden",
					backgroundColor: selected
						? palette.primary
						: palette.surfaceContainerHigh,
				},
				style,
			]}
		>
			<Pressable
				accessibilityRole="tab"
				accessibilityState={{ selected }}
				hitSlop={SLOP}
				onPress={onPress}
				onPressIn={() => press(1)}
				onPressOut={() => press(0)}
				android_ripple={{ color: palette.outlineVariant }}
				style={{
					flex: 1,
					alignItems: "center",
					justifyContent: "center",
					paddingHorizontal: 12,
				}}
			>
				<Text
					variant="labelLarge"
					numberOfLines={1}
					color={selected ? palette.onPrimary : palette.onSurface}
				>
					{label}
				</Text>
			</Pressable>
		</Animated.View>
	);
}
