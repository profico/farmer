import { View } from "react-native";

import { Icon } from "./icon";
import type { IconName } from "./icons";
import { usePalette } from "./theme";

/** The width and the height, in dp. */
const SIZE = 96;

export type IconBadgeProps = {
	icon: IconName;
	/** The tone of the container. */
	tone?: "secondary" | "error";
};

/** An icon in a round tonal container. Android draws an expressive shape
 *  instead (`icon-badge.android.tsx`). */
export function IconBadge({ icon, tone = "secondary" }: IconBadgeProps) {
	const palette = usePalette();
	return (
		<View
			style={{
				width: SIZE,
				height: SIZE,
				borderRadius: SIZE / 2,
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
				size={SIZE / 2.4}
				color={
					tone === "error"
						? palette.onErrorContainer
						: palette.onSecondaryContainer
				}
			/>
		</View>
	);
}
