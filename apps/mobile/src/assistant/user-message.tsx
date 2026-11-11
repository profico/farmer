import { View } from "react-native";

import { Text } from "../ui/components";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";

/** One thing the person said. */
export function UserMessage({ text }: { text: string }) {
	const palette = usePalette();
	return (
		<View style={{ alignItems: "flex-end" }}>
			<View
				style={{
					maxWidth: "85%",
					borderRadius: 20,
					paddingHorizontal: SPACE.l,
					paddingVertical: SPACE.m,
					backgroundColor: palette.secondaryContainer,
				}}
			>
				<Text color={palette.onSecondaryContainer}>{text}</Text>
			</View>
		</View>
	);
}
