import * as Haptics from "expo-haptics";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useState,
} from "react";
import {
	ActionSheetIOS,
	type AccessibilityActionEvent,
	type AccessibilityActionInfo,
	Platform,
} from "react-native";

import {
	menuItemsOf,
	type RowMenuEntry,
	type RowMenuItem,
} from "./row-menu-items";
import { RowMenuSheet } from "./row-menu-sheet";

type OpenMenu = { title: string; items: RowMenuItem[] };

const RowMenuContext = createContext<(menu: OpenMenu) => void>(() => undefined);

/**
 * The press-and-hold menu of a row, one for the whole app. Android opens a
 * Material 3 bottom sheet. iOS opens the action sheet of the system. The
 * provider sits above the navigator, so a row needs no sheet of its own.
 */
export function RowMenuProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState<OpenMenu | null>(null);
	const present = useCallback((menu: OpenMenu) => {
		if (Platform.OS === "ios") {
			ActionSheetIOS.showActionSheetWithOptions(
				{
					title: menu.title,
					options: [...menu.items.map((item) => item.label), "Cancel"],
					destructiveButtonIndex: menu.items.flatMap((item, index) =>
						item.destructive ? [index] : [],
					),
					cancelButtonIndex: menu.items.length,
				},
				(index) => menu.items[index]?.onPress(),
			);
			return;
		}
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

/** Opens the menu from code, for a button such as "more" on a row. Gives
 *  nothing to open when the list of items is empty. */
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

/**
 * The props that give a row its menu: a long press, and the same items as
 * actions for a screen reader. A row with no item gets no props, so it has
 * no long press.
 */
export function useRowMenu(
	title: string,
	entries: readonly RowMenuEntry[],
): RowMenuProps {
	const present = useContext(RowMenuContext);
	const items = menuItemsOf(entries);
	if (items.length === 0) return NO_MENU;
	return {
		onLongPress: () => {
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
	};
}

const NO_MENU: RowMenuProps = {};
