import { MenuView } from "@expo/ui/community/menu";
import { View } from "react-native";

import { Icon } from "./icon";
import { ICONS } from "./icons";
import { menuItemsOf } from "./row-menu-items";
import type { RowMoreMenuProps } from "./row-more-menu";
import { usePalette } from "./theme";

/** A pull-down menu of the system, opened by a tap on "more". */
export function RowMoreMenu({ title, entries }: RowMoreMenuProps) {
	const palette = usePalette();
	const items = menuItemsOf(entries);
	if (items.length === 0) return null;
	return (
		<MenuView
			actions={items.map((item, index) => ({
				id: String(index),
				title: item.label,
				image: ICONS[item.icon].sf,
				attributes: item.destructive ? { destructive: true } : undefined,
			}))}
			onPressAction={(event) =>
				items[Number(event.nativeEvent.event)]?.onPress()
			}
		>
			<View
				accessible
				accessibilityRole="button"
				accessibilityLabel={`Actions for ${title}`}
				style={{
					width: 44,
					height: 44,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<Icon name="more" size={20} color={palette.primary} weight="medium" />
			</View>
		</MenuView>
	);
}
