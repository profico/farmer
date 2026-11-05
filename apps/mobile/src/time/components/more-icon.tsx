import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ColorValue } from "react-native";

/** The icon of a menu of more actions: three dots. iOS draws an SF Symbol
 *  (`more-icon.ios.tsx`). Hidden from a screen reader, as `ui/icon.tsx`
 *  does; the control around it has the label. */
export function MoreIcon({ color }: { color: ColorValue }) {
	return (
		<MaterialIcons
			name="more-vert"
			size={24}
			color={color}
			accessible={false}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		/>
	);
}
