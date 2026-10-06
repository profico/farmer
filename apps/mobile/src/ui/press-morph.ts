import { useEffect } from "react";
import {
	interpolate,
	useAnimatedStyle,
	useSharedValue,
	withSpring,
	withTiming,
} from "react-native-reanimated";

import { useSpring } from "./motion";

// The press shape of Material 3 Expressive: the corners of a surface move
// toward a larger radius while a finger holds it, and spring back.

export type Corners = {
	borderTopLeftRadius: number;
	borderTopRightRadius: number;
	borderBottomLeftRadius: number;
	borderBottomRightRadius: number;
};

/** Four equal corners. */
export const evenCorners = (radius: number): Corners => ({
	borderTopLeftRadius: radius,
	borderTopRightRadius: radius,
	borderBottomLeftRadius: radius,
	borderBottomRightRadius: radius,
});

/**
 * The animated corner style and the two press handlers for a surface.
 * `rest` is the shape at rest. `pressed` is the radius that each corner
 * moves to. With less motion, the corners do not move.
 */
export function useCornerMorph(rest: Corners, pressed: number) {
	const choice = useSpring("fastSpatial");
	const progress = useSharedValue(0);
	const { borderTopLeftRadius: tl } = rest;
	const { borderTopRightRadius: tr } = rest;
	const { borderBottomLeftRadius: bl } = rest;
	const { borderBottomRightRadius: br } = rest;
	const style = useAnimatedStyle(() => {
		// A spring may overshoot, and a radius cannot be below zero.
		const to = (from: number) =>
			Math.max(0, interpolate(progress.value, [0, 1], [from, pressed]));
		return {
			borderTopLeftRadius: to(tl),
			borderTopRightRadius: to(tr),
			borderBottomLeftRadius: to(bl),
			borderBottomRightRadius: to(br),
		};
	}, [tl, tr, bl, br, pressed]);
	const move = (target: number) => {
		if (choice.reduced) {
			progress.set(withTiming(0, { duration: 0 }));
			return;
		}
		progress.set(withSpring(target, choice.spring));
	};
	return {
		style,
		onPressIn: () => move(1),
		onPressOut: () => move(0),
	};
}

/**
 * The shape of a toggle button (Material 3 Expressive). The corners spring
 * between `rest` (off) and `on` as `selected` changes. A press moves them
 * toward the other shape. With less motion, the corners jump to the shape.
 */
export function useToggleMorph(selected: boolean, rest: number, on: number) {
	const choice = useSpring("fastSpatial");
	const state = useSharedValue(selected ? 1 : 0);
	const press = useSharedValue(0);
	useEffect(() => {
		const target = selected ? 1 : 0;
		state.set(
			choice.reduced
				? withTiming(target, { duration: 0 })
				: withSpring(target, choice.spring),
		);
	}, [selected, choice, state]);
	const style = useAnimatedStyle(() => {
		const base = interpolate(state.value, [0, 1], [rest, on]);
		// The pressed shape is the shape that the toggle would swap to.
		const other = interpolate(state.value, [0, 1], [on, rest]);
		const radius = Math.max(0, interpolate(press.value, [0, 1], [base, other]));
		return {
			borderTopLeftRadius: radius,
			borderTopRightRadius: radius,
			borderBottomLeftRadius: radius,
			borderBottomRightRadius: radius,
		};
	}, [rest, on]);
	const move = (target: number) => {
		if (choice.reduced) {
			press.set(withTiming(0, { duration: 0 }));
			return;
		}
		press.set(withSpring(target, choice.spring));
	};
	return {
		style,
		onPressIn: () => move(1),
		onPressOut: () => move(0),
	};
}
