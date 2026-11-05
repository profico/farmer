import { SymbolView } from "expo-symbols";
import type { ColorValue } from "react-native";

import { usePalette } from "../../ui/theme";

/** A bar button item draws in the accent colour, so iOS ignores the colour
 *  that the caller gives. */
export function MoreIcon(_props: { color: ColorValue }) {
	const palette = usePalette();
	return (
		<SymbolView
			name="ellipsis.circle"
			size={20}
			weight="medium"
			tintColor={palette.primary}
			resizeMode="scaleAspectFit"
			accessible={false}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		/>
	);
}
