import { Box, Host } from "@expo/ui/jetpack-compose";
import * as modifiers from "@expo/ui/jetpack-compose/modifiers";
import { View } from "react-native";

import { Icon } from "./icon";
import type { IconBadgeProps } from "./icon-badge";
import { usePalette } from "./theme";

/** The width and the height, in dp. */
const SIZE = 96;

/**
 * An icon in a large tonal container with an expressive Material shape. The
 * shape and the fill are Compose (`clip`), and the icon is drawn over it.
 * The error tone has a sunny shape, and the rest has nine rounded sides.
 */
export function IconBadge({ icon, tone = "secondary" }: IconBadgeProps) {
	const palette = usePalette();
	const error = tone === "error";
	return (
		<View
			style={{
				width: SIZE,
				height: SIZE,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Host style={{ position: "absolute", width: SIZE, height: SIZE }}>
				<Box
					modifiers={[
						modifiers.size(SIZE, SIZE),
						modifiers.clip(
							error
								? modifiers.Shapes.Material.Sunny
								: modifiers.Shapes.Material.Cookie9Sided,
						),
						modifiers.background(
							error ? palette.errorContainer : palette.secondaryContainer,
						),
					]}
				/>
			</Host>
			<Icon
				name={icon}
				size={SIZE / 2.4}
				color={error ? palette.onErrorContainer : palette.onSecondaryContainer}
			/>
		</View>
	);
}
