import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { Animated, Easing, type StyleProp, type ViewStyle } from "react-native";

// The motion of a Rewind slide. Each part of a slide rises in after the one
// before it when the slide comes on screen, and a number counts up to its
// value. With "reduce motion" on, a part fades in where it stands and a
// number shows its value at once.

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const STEP_MS = 160;
const FIRST_MS = 120;

type SlideMotion = {
	/** True while the slide is the one on screen. */
	active: boolean;
	reduce: boolean;
};

const MotionContext = createContext<SlideMotion>({
	active: true,
	reduce: false,
});

/** The motion of one slide. Its parts start when `active` becomes true,
 *  and go back to the start when the slide leaves the screen. */
export function SlideMotionProvider({
	active,
	reduce,
	children,
}: SlideMotion & { children: ReactNode }) {
	return <MotionContext value={{ active, reduce }}>{children}</MotionContext>;
}

export const useSlideMotion = () => use(MotionContext);

/** A value that goes from 0 to 1 when the slide comes on screen, after
 *  `delay`, and back to 0 at once when it leaves. */
export const useEntrance = (delay: number, duration = 750) => {
	const { active, reduce } = useSlideMotion();
	const [progress] = useState(() => new Animated.Value(0));
	useEffect(() => {
		if (!active) {
			progress.setValue(0);
			return;
		}
		const animation = Animated.timing(progress, {
			toValue: 1,
			delay: reduce ? 0 : delay,
			duration: reduce ? 200 : duration,
			easing: EASE_OUT,
			useNativeDriver: true,
		});
		animation.start();
		return () => animation.stop();
	}, [active, reduce, delay, duration, progress]);
	return progress;
};

/** One part of a slide. `order` is its place in the slide: 0 rises
 *  first. */
export function Rise({
	order,
	children,
	style,
}: {
	order: number;
	children: ReactNode;
	style?: StyleProp<ViewStyle>;
}) {
	const { reduce } = useSlideMotion();
	const progress = useEntrance(FIRST_MS + order * STEP_MS);
	return (
		<Animated.View
			style={[
				style,
				{
					opacity: progress,
					transform: reduce
						? []
						: [
								{
									translateY: progress.interpolate({
										inputRange: [0, 1],
										outputRange: [28, 0],
									}),
								},
							],
				},
			]}
		>
			{children}
		</Animated.View>
	);
}

/** A number that counts up to its value when the slide comes on screen. */
export function useCountUp(value: number, delay = 350): number {
	const { active, reduce } = useSlideMotion();
	const [counter] = useState(() => new Animated.Value(0));
	const [shown, setShown] = useState(0);
	// The text follows the animated value. A listener reads it on the JS
	// thread, so the animation cannot use the native driver.
	useEffect(() => {
		const id = counter.addListener(({ value: next }) => setShown(next));
		return () => counter.removeListener(id);
	}, [counter]);
	useEffect(() => {
		if (!active) {
			counter.setValue(0);
			return;
		}
		if (reduce) {
			counter.setValue(value);
			return;
		}
		const animation = Animated.timing(counter, {
			toValue: value,
			delay,
			duration: 1600,
			easing: EASE_OUT,
			useNativeDriver: false,
		});
		animation.start();
		return () => animation.stop();
	}, [active, reduce, value, delay, counter]);
	return shown;
}
