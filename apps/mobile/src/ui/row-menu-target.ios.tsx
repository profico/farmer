import { Link } from "expo-router";
import { View } from "react-native";

import { ICONS } from "./icons";
import type { RowMenuTargetProps } from "./row-menu-target";

/**
 * The row in a context menu of the system: a press and hold lifts the row
 * and shows the items, with an SF Symbol each. The row keeps its own press.
 * The link never navigates: it is only the carrier of the menu, so a row
 * that opens nothing still gets one.
 */
export function RowMenuTarget({ items, style, children }: RowMenuTargetProps) {
	return (
		<Link href="/" asChild onPress={(event) => event.preventDefault()}>
			<Link.Trigger>
				{/* A plain view carries the link: the link would replace the style
				    function of a pressable that it wrapped. */}
				<View style={style}>{children}</View>
			</Link.Trigger>
			<Link.Menu>
				{items.map((item) => (
					<Link.MenuAction
						key={item.label}
						icon={ICONS[item.icon].sf}
						destructive={item.destructive}
						onPress={item.onPress}
					>
						{item.label}
					</Link.MenuAction>
				))}
			</Link.Menu>
		</Link>
	);
}
