import { Stack } from "expo-router";

import { ActionButton, IconButton } from "../ui/components";
import type { HeaderAction } from "./header-actions.shared";

/**
 * The buttons at the end of the navigation header of the screen that
 * renders this. Android draws Material buttons in the header. iOS draws bar
 * button items, which the system sets in glass (`header-actions.ios.tsx`).
 */
export function HeaderActions({ actions }: { actions: HeaderAction[] }) {
	return (
		<Stack.Screen
			options={{
				headerRight:
					actions.length === 0
						? undefined
						: () => (
								<>
									{actions.map((action) =>
										action.icon === undefined ? (
											<ActionButton
												key={action.label}
												label={action.label}
												onPress={action.onPress}
												disabled={action.disabled}
											/>
										) : (
											<IconButton
												key={action.label}
												icon={action.icon}
												label={action.label}
												onPress={action.onPress}
												disabled={action.disabled}
											/>
										),
									)}
								</>
							),
			}}
		/>
	);
}
