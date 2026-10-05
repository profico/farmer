import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ColorValue } from "react-native";

import { ICONS, type IconName } from "./icons";

export type IconProps = { name: IconName; size?: number; color: ColorValue };

/** A Material icon. iOS draws an SF Symbol instead (`icon.ios.tsx`). */
export function Icon({ name, size = 24, color }: IconProps) {
	return <MaterialIcons name={ICONS[name].md} size={size} color={color} />;
}
