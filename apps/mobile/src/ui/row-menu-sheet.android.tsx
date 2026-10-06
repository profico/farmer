import { Host, ModalBottomSheet, RNHostView } from "@expo/ui/jetpack-compose";
import { Pressable, Text, View } from "react-native";

import { useHostTheme } from "./host";
import { Icon } from "./icon";
import type { RowMenuSheetProps } from "./row-menu-sheet";
import { usePalette } from "./theme";
import { SPACE, TYPE } from "./type";

/**
 * The Material 3 modal bottom sheet, with one row for each item. The sheet is
 * Compose. The rows are React Native, so they use the icon set of the app.
 * The file does not import `components.tsx`, which would make a cycle.
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
								numberOfLines={1}
								style={[TYPE.titleSmall, { color: palette.onSurfaceVariant }]}
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
									<Text style={[TYPE.bodyLarge, { color }]}>{item.label}</Text>
								</Pressable>
							);
						})}
					</View>
				</RNHostView>
			</ModalBottomSheet>
		</Host>
	);
}
