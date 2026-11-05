import type { ReactNode } from "react";
import Animated from "react-native-reanimated";

import { groupedCorners, RADIUS } from "../ui/corner";
import { useCornerMorph } from "../ui/press-morph";
import { usePalette } from "../ui/theme";

/**
 * One entry of the day as its own surface, for Android: the Material 3
 * Expressive segmented list. The outer corners of the list are large, the
 * corners between two rows are small, and a pressed row morphs toward a
 * large corner. `children` is a function, because the row reports the
 * press to the surface.
 */
export function EntrySurface({
	index,
	count,
	children,
}: {
	index: number;
	count: number;
	children: (press: {
		onPressIn: () => void;
		onPressOut: () => void;
	}) => ReactNode;
}) {
	const palette = usePalette();
	const corners = groupedCorners(index, count);
	const morph = useCornerMorph(corners, RADIUS.listGroup);
	return (
		<Animated.View
			style={[
				{ overflow: "hidden", backgroundColor: palette.surfaceContainer },
				corners,
				morph.style,
			]}
		>
			{children({ onPressIn: morph.onPressIn, onPressOut: morph.onPressOut })}
		</Animated.View>
	);
}
