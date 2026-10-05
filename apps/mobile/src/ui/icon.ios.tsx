import { SymbolView } from "expo-symbols";

import type { IconProps } from "./icon";
import { ICONS } from "./icons";

export function Icon({ name, size = 22, color }: IconProps) {
	return (
		<SymbolView
			name={ICONS[name].sf}
			size={size}
			tintColor={color}
			resizeMode="scaleAspectFit"
		/>
	);
}
