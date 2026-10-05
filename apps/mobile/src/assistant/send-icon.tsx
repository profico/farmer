import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ColorValue } from "react-native";

/**
 * The arrow of the send button. `src/ui/icons.ts` has no "send" role yet,
 * so the composer draws its own, in the way `src/ui/icon.tsx` does. iOS
 * draws an SF Symbol (`send-icon.ios.tsx`).
 */
export function SendIcon({ color }: { color: ColorValue }) {
	return (
		<MaterialIcons
			name="arrow-upward"
			size={22}
			color={color}
			accessible={false}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		/>
	);
}
