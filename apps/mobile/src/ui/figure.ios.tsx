import { Host, Text } from "@expo/ui/swift-ui";
import {
	Animation,
	animation,
	contentTransition,
	font,
	foregroundStyle,
	monospacedDigit,
} from "@expo/ui/swift-ui/modifiers";

import type { FigureProps } from "./figure";
import { useHostTheme } from "./host";
import { useMotionPreference } from "./motion";
import { usePalette } from "./theme";

// A critically damped spring: the digits settle with no overshoot.
const ROLL = Animation.spring({ duration: 0.3, bounce: 0 });

/** The total of a day as SwiftUI text, so its digits roll to a new value. */
export function Figure({ text, value, color }: FigureProps) {
	const hostTheme = useHostTheme();
	const palette = usePalette();
	const { reduceMotion } = useMotionPreference();
	return (
		<Host matchContents {...hostTheme}>
			<Text
				modifiers={[
					font({ textStyle: "callout", size: 16, weight: "medium" }),
					monospacedDigit(),
					foregroundStyle(String(color ?? palette.onSurface)),
					contentTransition(reduceMotion ? "identity" : "numericText", {
						countsDown: false,
					}),
					animation(ROLL, value),
				]}
			>
				{text}
			</Text>
		</Host>
	);
}
