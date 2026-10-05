import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ColorValue } from "react-native";

import { WORKSPACE_ICONS, type WorkspaceIconName } from "./icons";

export type WorkspaceIconProps = {
	name: WorkspaceIconName;
	size?: number;
	color: ColorValue;
};

/**
 * A Material icon of the workspace screens. iOS draws an SF Symbol
 * (`icon.ios.tsx`). As in `src/ui/icon.tsx`, the icon is hidden from a
 * screen reader: the control around it carries the label.
 */
export function WorkspaceIcon({ name, size = 24, color }: WorkspaceIconProps) {
	return (
		<MaterialIcons
			name={WORKSPACE_ICONS[name].md}
			size={size}
			color={color}
			accessible={false}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		/>
	);
}
