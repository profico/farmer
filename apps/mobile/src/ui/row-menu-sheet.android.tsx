import { Host, ModalBottomSheet, RNHostView } from "@expo/ui/jetpack-compose";
import { Pressable, View } from "react-native";

import { Text } from "./components";
import { useHostTheme } from "./host";
import { Icon } from "./icon";
import type { RowMenuSheetProps } from "./row-menu-sheet";
import { usePalette } from "./theme";
import { SPACE } from "./type";

/**
 * The Material 3 modal bottom sheet, with one row for each item. The sheet is
 * Compose. The rows are React Native, so they use the icon set of the app.
 * An item runs after the sheet is gone, so a confirmation opens on a clear
 * screen.
 */
export function RowMenuSheet({ title, items, onClose }: RowMenuSheetProps) {
	const palette = usePalette();
	const hostTheme = useHostTheme();
	return (
		<Host style={{ position: "absolute", width: 0, height: 0 }} {...hostTheme}>
			<ModalBottomSheet
				skipPartiallyExpanded
				onDismissRequest={onClose}
				containerColor={palette.surfaceContainerLow}
			>
				<RNHostView matchContents>
					<View style={{ paddingBottom: SPACE.xl }}>
						<View
							style={{
								paddingHorizontal: SPACE.l,
								paddingBottom: SPACE.s,
							}}
						>
							<Text
								variant="titleSmall"
								color={palette.onSurfaceVariant}
								numberOfLines={1}
							>
								{title}
							</Text>
						</View>
						{items.map((item) => {
							const color = item.destructive
								? palette.error
								: palette.onSurface;
							return (
								<Pressable
									key={item.label}
									accessibilityRole="button"
									accessibilityLabel={item.label}
									onPress={() => {
										onClose();
										item.onPress();
									}}
									android_ripple={{ color: palette.outlineVariant }}
									style={{
										flexDirection: "row",
										alignItems: "center",
										gap: SPACE.l,
										minHeight: 56,
										paddingHorizontal: SPACE.l,
									}}
								>
									<Icon name={item.icon} size={24} color={color} />
									<Text variant="bodyLarge" color={color}>
										{item.label}
									</Text>
								</Pressable>
							);
						})}
					</View>
				</RNHostView>
			</ModalBottomSheet>
		</Host>
	);
}
