import { SymbolView } from "expo-symbols";
import type { ColorValue } from "react-native";

export function MoreIcon({ color }: { color: ColorValue }) {
	return (
		<SymbolView
			name="ellipsis.circle"
			size={22}
			tintColor={color}
			resizeMode="scaleAspectFit"
			accessible={false}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		/>
	);
}
