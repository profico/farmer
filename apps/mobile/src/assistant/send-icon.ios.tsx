import { SymbolView } from "expo-symbols";
import type { ColorValue } from "react-native";

export function SendIcon({ color }: { color: ColorValue }) {
	return (
		<SymbolView
			name="arrow.up"
			size={20}
			weight="semibold"
			tintColor={color}
			resizeMode="scaleAspectFit"
			accessible={false}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		/>
	);
}
