import {
	Host,
	LoadingIndicator as ComposeIndicator,
} from "@expo/ui/jetpack-compose";
import { size as sizeModifier } from "@expo/ui/jetpack-compose/modifiers";
import { View } from "react-native";

import { useHostTheme } from "./host";
import type { LoadingIndicatorProps } from "./loading";
import { usePalette } from "./theme";

/** The Material 3 Expressive loading indicator: a shape that morphs. It
 *  turns on its own, because it is the information, as a spinner is. */
export function LoadingIndicator({
	size = 48,
	color,
	accessibilityLabel = "Loading",
}: LoadingIndicatorProps) {
	const hostTheme = useHostTheme();
	const palette = usePalette();
	return (
		<View
			accessible
			accessibilityRole="progressbar"
			accessibilityLabel={accessibilityLabel}
			style={{ width: size, height: size }}
		>
			<Host style={{ width: size, height: size }} {...hostTheme}>
				<ComposeIndicator
					color={color ?? palette.primary}
					modifiers={[sizeModifier(size, size)]}
				/>
			</Host>
		</View>
	);
}
