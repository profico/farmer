import * as Haptics from "expo-haptics";
import {
	createContext,
	type ReactElement,
	type ReactNode,
	useCallback,
	useContext,
	useState,
} from "react";
import {
	type AccessibilityActionEvent,
	type AccessibilityActionInfo,
	Platform,
	type ViewStyle,
} from "react-native";

import {
	menuItemsOf,
	type RowMenuEntry,
	type RowMenuItem,
} from "./row-menu-items";
import { RowMenuSheet } from "./row-menu-sheet";
import { RowMenuTarget } from "./row-menu-target";

type OpenMenu = { title: string; items: RowMenuItem[] };

const RowMenuContext = createContext<(menu: OpenMenu) => void>(() => undefined);

/**
 * The press-and-hold menu of a row, one for the whole app. Android opens a
 * Material 3 bottom sheet from this provider, which sits above the
 * navigator, so a row needs no sheet of its own. iOS draws a context menu
 * of the system on the row itself (`row-menu-target.ios.tsx`).
 */
export function RowMenuProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState<OpenMenu | null>(null);
	const present = useCallback((menu: OpenMenu) => {
		setOpen(menu);
	}, []);
	return (
		<RowMenuContext.Provider value={present}>
			{children}
			{open ? (
				<RowMenuSheet
					title={open.title}
					items={open.items}
					onClose={() => setOpen(null)}
				/>
			) : null}
		</RowMenuContext.Provider>
	);
}

/** Opens the sheet from code, for a button such as "more" on a row. Only
 *  Android has a sheet to open: iOS draws a pull-down menu on the button
 *  (`row-more-menu.ios.tsx`). Gives nothing to open when the list of
 *  items is empty. */
export function useOpenRowMenu() {
	const present = useContext(RowMenuContext);
	return useCallback(
		(title: string, entries: readonly RowMenuEntry[]) => {
			const items = menuItemsOf(entries);
			if (items.length > 0) present({ title, items });
		},
		[present],
	);
}

export type RowMenuProps = {
	onLongPress?: () => void;
	accessibilityActions?: AccessibilityActionInfo[];
	onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
};

export type RowMenuWrapOptions = {
	style?: ViewStyle;
};

export type RowMenu = {
	/** Spread on the row: a long press on Android, and the same items as
	 *  actions for a screen reader. */
	props: RowMenuProps;
	/** Wraps the row. iOS draws the context menu of the system around it;
	 *  Android returns the row as it is. Pass `style` for a row that is not the
	 *  full width of its parent. */
	wrap: (row: ReactElement, options?: RowMenuWrapOptions) => ReactElement;
};

/**
 * The menu of a row: its long press and screen reader actions in `props`,
 * and the wrapper that draws the menu in `wrap`. The items are the one
 * source of both. A row with no item gets no props, so it has no menu.
 */
export function useRowMenu(
	title: string,
	entries: readonly RowMenuEntry[],
): RowMenu {
	const present = useContext(RowMenuContext);
	const items = menuItemsOf(entries);
	if (items.length === 0) return NO_MENU;
	return {
		props: {
			// iOS opens the context menu of the system by itself.
			onLongPress:
				Platform.OS === "ios"
					? undefined
					: () => {
							// A light tap tells the person that the hold worked.
							void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
								() => undefined,
							);
							present({ title, items });
						},
			accessibilityActions: items.map((item, index) => ({
				name: `item-${index}`,
				label: item.label,
			})),
			onAccessibilityAction: (event) => {
				const index = Number(event.nativeEvent.actionName.replace("item-", ""));
				items[index]?.onPress();
			},
		},
		wrap: (row, options) => (
			<RowMenuTarget items={items} style={options?.style}>
				{row}
			</RowMenuTarget>
		),
	};
}

const NO_MENU: RowMenu = { props: {}, wrap: (row) => row };
