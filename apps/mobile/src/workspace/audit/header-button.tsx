import { Pressable } from "react-native";

import { usePalette } from "../../ui/theme";
import { WorkspaceIcon } from "../icon";
import type { WorkspaceIconName } from "../icons";

/**
 * A round header button with an icon of the workspace set. `IconButton`
 * of the kit takes only the icons of `src/ui/icons.ts`.
 */
export function HeaderButton({
	icon,
	label,
	onPress,
}: {
	icon: WorkspaceIconName;
	/** Read out by a screen reader. */
	label: string;
	onPress: () => void;
}) {
	const palette = usePalette();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			hitSlop={4}
			android_ripple={{ color: palette.outlineVariant, borderless: true }}
			style={({ pressed }) => ({
				width: 40,
				height: 40,
				borderRadius: 20,
				alignItems: "center",
				justifyContent: "center",
				opacity: pressed ? 0.5 : 1,
			})}
		>
			<WorkspaceIcon name={icon} size={22} color={palette.onSurfaceVariant} />
		</Pressable>
	);
}
