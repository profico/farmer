import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ColorValue } from "react-native";

import { ICONS, type IconName } from "./icons";

export type IconWeight = "light" | "regular" | "medium" | "semibold" | "bold";

export type IconProps = {
	name: IconName;
	size?: number;
	color: ColorValue;
	/** iOS only: the weight of the SF Symbol, to match the text beside it. */
	weight?: IconWeight;
};

/**
 * A Material icon. iOS draws an SF Symbol instead (`icon.ios.tsx`). The
 * icon font draws a glyph from the private use area, which a screen reader
 * reads out as noise, so the icon is hidden from it: the control around an
 * icon carries the label.
 */
export function Icon({ name, size = 24, color }: IconProps) {
	return (
		<MaterialIcons
			name={ICONS[name].md}
			size={size}
			color={color}
			accessible={false}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		/>
	);
}
