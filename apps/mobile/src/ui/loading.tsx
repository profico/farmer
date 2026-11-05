import { ActivityIndicator, type ColorValue } from "react-native";

import { usePalette } from "./theme";

export type LoadingIndicatorProps = {
	/** The width and the height, in dp. */
	size?: number;
	/** The colour of the mark. The primary colour when not given. */
	color?: ColorValue;
	accessibilityLabel?: string;
};

/** A busy mark. Android draws the Material 3 Expressive shape-morph
 *  indicator instead (`loading.android.tsx`). */
export function LoadingIndicator({
	size = 48,
	color,
	accessibilityLabel,
}: LoadingIndicatorProps) {
	const palette = usePalette();
	return (
		<ActivityIndicator
			size={size > 32 ? "large" : "small"}
			color={color ?? palette.primary}
			accessibilityLabel={accessibilityLabel}
		/>
	);
}
