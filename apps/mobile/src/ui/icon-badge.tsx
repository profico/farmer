import { View } from "react-native";

import { Icon } from "./icon";
import type { IconName } from "./icons";
import { usePalette } from "./theme";

export type IconBadgeProps = {
	icon: IconName;
	/** The tone of the container. */
	tone?: "secondary" | "error";
	/** The width and the height, in dp. */
	size?: number;
};

/** An icon in a round tonal container. Android draws an expressive shape
 *  instead (`shape-badge.android.tsx`). */
export function IconBadge({
	icon,
	tone = "secondary",
	size = 96,
}: IconBadgeProps) {
	const palette = usePalette();
	return (
		<View
			style={{
				width: size,
				height: size,
				borderRadius: size / 2,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor:
					tone === "error"
						? palette.errorContainer
						: palette.secondaryContainer,
			}}
		>
			<Icon
				name={icon}
				size={size / 2.4}
				color={
					tone === "error"
						? palette.onErrorContainer
						: palette.onSecondaryContainer
				}
			/>
		</View>
	);
}
