import { Stack } from "expo-router";

import { ICONS } from "../ui/icons";
import { WORKSPACE_ICONS } from "../workspace/icons";
import { type HeaderAction, isKitIcon } from "./header-actions.shared";

const symbolOf = (name: NonNullable<HeaderAction["icon"]>) =>
	isKitIcon(name) ? ICONS[name].sf : WORKSPACE_ICONS[name].sf;

/**
 * The buttons at the end of the navigation header, as bar button items. The
 * system draws them: in glass on iOS 26, with no container of our own.
 */
export function HeaderActions({ actions }: { actions: HeaderAction[] }) {
	if (actions.length === 0) return null;
	return (
		<Stack.Toolbar placement="right">
			{actions.map((action) => (
				<Stack.Toolbar.Button
					key={action.label}
					icon={action.icon ? symbolOf(action.icon) : undefined}
					accessibilityLabel={action.label}
					disabled={action.disabled}
					variant={action.prominent ? "done" : "plain"}
					onPress={action.onPress}
				>
					{action.icon ? undefined : action.label}
				</Stack.Toolbar.Button>
			))}
		</Stack.Toolbar>
	);
}
