import { SymbolView } from "expo-symbols";

import type { WorkspaceIconProps } from "./icon";
import { WORKSPACE_ICONS } from "./icons";

export function WorkspaceIcon({ name, size = 22, color }: WorkspaceIconProps) {
	return (
		<SymbolView
			name={WORKSPACE_ICONS[name].sf}
			size={size}
			tintColor={color}
			resizeMode="scaleAspectFit"
			accessible={false}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		/>
	);
}
