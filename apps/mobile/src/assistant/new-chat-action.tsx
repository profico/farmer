import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
	FAB_CLEARANCE,
	FAB_MARGIN,
	FAB_SIZE,
} from "../time/components/log-time-fab";
import { Text } from "../ui/components";
import { RADIUS } from "../ui/corner";
import { Icon } from "../ui/icon";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";

/** The space below the last chat that the pill takes. iOS has no pill. */
export const NEW_CHAT_CLEARANCE = FAB_CLEARANCE;

/** The gap between the icon and the label of the pill. */
const PILL_GAP = SPACE.m;

/** "New chat": an extended FAB at the bottom right, in the style of the
 *  Log time pill of the Time tab. */
export function NewChatAction({ onPress }: { onPress: () => void }) {
	const palette = usePalette();
	const insets = useSafeAreaInsets();
	return (
		<View
			pointerEvents="box-none"
			style={{
				position: "absolute",
				right: FAB_MARGIN,
				bottom: FAB_MARGIN + insets.bottom,
			}}
		>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="New chat"
				onPress={onPress}
				android_ripple={{
					color: palette.onPrimaryContainer,
					borderless: false,
				}}
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: PILL_GAP,
					height: FAB_SIZE,
					paddingHorizontal: SPACE.l,
					borderRadius: RADIUS.fab,
					overflow: "hidden",
					backgroundColor: palette.primaryContainer,
					elevation: 3,
				}}
			>
				<Icon name="add" color={palette.onPrimaryContainer} />
				<Text variant="labelLarge" color={palette.onPrimaryContainer}>
					New chat
				</Text>
			</Pressable>
		</View>
	);
}
