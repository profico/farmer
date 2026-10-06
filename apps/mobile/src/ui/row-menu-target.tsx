import type { ReactElement } from "react";
import type { ViewStyle } from "react-native";

import type { RowMenuItem } from "./row-menu-items";

export type RowMenuTargetProps = {
	items: RowMenuItem[];
	/** The style of the view that carries the menu, for a row that is not
	 *  the full width of its parent. */
	style?: ViewStyle;
	children: ReactElement;
};

/**
 * The row that carries a menu. Android opens a bottom sheet from a long
 * press, which `useRowMenu` sets up, so this draws the row as it is. iOS
 * draws the context menu of the system (`row-menu-target.ios.tsx`).
 */
export function RowMenuTarget({ children }: RowMenuTargetProps) {
	return children;
}
