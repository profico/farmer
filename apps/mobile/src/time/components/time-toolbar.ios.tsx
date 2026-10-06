import { Stack } from "expo-router";

import type { MoreAction } from "./more-menu";

/**
 * The bar items of the Time tab: "Log time" as a plus, and the menu of
 * more actions behind an ellipsis, as the system draws them in glass.
 */
export function TimeToolbar({
	actions,
	onAction,
	onLog,
}: {
	actions: MoreAction[];
	onAction: (id: string) => void;
	onLog: () => void;
}) {
	return (
		<Stack.Toolbar placement="right">
			<Stack.Toolbar.Button
				icon="plus"
				accessibilityLabel="Log time"
				onPress={onLog}
			/>
			<Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More actions">
				{actions.map((action) => (
					<Stack.Toolbar.MenuAction
						key={action.id}
						disabled={action.disabled}
						onPress={() => onAction(action.id)}
					>
						{action.title}
					</Stack.Toolbar.MenuAction>
				))}
			</Stack.Toolbar.Menu>
		</Stack.Toolbar>
	);
}
