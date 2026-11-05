import { SymbolView } from "expo-symbols";

import type { IconProps } from "./icon";
import { ICONS } from "./icons";

/** An SF Symbol. The weight of the text beside it is "regular", and the
 *  symbol takes the same weight unless the caller gives another. */
export function Icon({
	name,
	size = 22,
	color,
	weight = "regular",
}: IconProps) {
	return (
		<SymbolView
			name={ICONS[name].sf}
			size={size}
			weight={weight}
			tintColor={color}
			resizeMode="scaleAspectFit"
			accessible={false}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		/>
	);
}
