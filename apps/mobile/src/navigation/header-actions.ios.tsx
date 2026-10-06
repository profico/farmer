import { Stack } from "expo-router";

import { ICONS } from "../ui/icons";
import { usePalette } from "../ui/theme";
import type { HeaderAction } from "./header-actions.shared";

/**
 * The buttons at the end of the navigation header, as bar button items. The
 * system draws them: in glass on iOS 26, with no container of our own.
 */
export function HeaderActions({ actions }: { actions: HeaderAction[] }) {
	const palette = usePalette();
	if (actions.length === 0) return null;
	return (
		<Stack.Toolbar placement="right">
			{actions.map((action) => (
				<Stack.Toolbar.Button
					key={action.label}
					icon={action.icon ? ICONS[action.icon].sf : undefined}
					accessibilityLabel={action.label}
					disabled={action.disabled}
					variant={action.prominent ? "done" : "plain"}
					tintColor={action.prominent ? palette.primary : undefined}
					onPress={action.onPress}
				>
					{action.icon ? undefined : action.label}
				</Stack.Toolbar.Button>
			))}
		</Stack.Toolbar>
	);
}
