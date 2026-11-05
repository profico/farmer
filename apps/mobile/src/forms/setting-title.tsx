import { Platform } from "react-native";

import { Text } from "../ui/components";
import { usePalette } from "../ui/theme";
import { GroupCaption } from "./form-group";

/** The title above a setting that has its own fields. iOS draws the small
 *  capitals of a section header, as the other sections do. Android draws
 *  the title in the accent colour. */
export function SettingTitle({ children }: { children: string }) {
	const palette = usePalette();
	if (Platform.OS === "ios") {
		return <GroupCaption>{children.toUpperCase()}</GroupCaption>;
	}
	return (
		<Text variant="titleSmall" color={palette.primary}>
			{children}
		</Text>
	);
}
