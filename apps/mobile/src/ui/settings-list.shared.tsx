import {
	Children,
	createContext,
	isValidElement,
	type ReactNode,
	use,
} from "react";

import type { IconName } from "./icons";
import type { RowMenuEntry } from "./row-menu-items";

// The props of the settings-list kit, and the part both platforms share.
// `settings-list.tsx` (Android) and `settings-list.ios.tsx` draw the rows.

/** The colour of the icon tile on iOS. Android draws every icon in the
 *  colour for icons on a surface, so it ignores this. */
export type RowTint =
	| "blue"
	| "green"
	| "orange"
	| "red"
	| "purple"
	| "indigo"
	| "teal"
	| "pink"
	| "gray";

export type SettingsSectionProps = {
	title?: string;
	/** A line under the section that explains it. */
	footer?: string;
	children: ReactNode;
};

export type RowBase = {
	icon?: IconName;
	tint?: RowTint;
	title: string;
	subtitle?: string;
	/** The menu of a long press, and the same actions for a screen reader.
	 *  The caller leaves out an action that the person may not do. */
	actions?: readonly RowMenuEntry[];
};

export type SettingsLinkProps = RowBase & {
	onPress: () => void;
	/** A value to show before the chevron, such as the current choice. */
	value?: string;
	/** A row that ends something, such as "Sign out". */
	destructive?: boolean;
	/** The row opens a browser, not a screen of the app. */
	external?: boolean;
};

/** One option of a choice, with a check icon on the chosen one. */
export type SettingsChoiceProps = RowBase & {
	selected: boolean;
	onPress: () => void;
};

export type SettingsSwitchProps = RowBase & {
	value: boolean;
	onValueChange: (value: boolean) => void;
	disabled?: boolean;
};

export type SettingsValueProps = RowBase & {
	value: string;
	onPress?: () => void;
};

/** The place of a row in its section. iOS draws no line under the last
 *  row. Android rounds the outer corners of the first and the last. */
export const RowPosition = createContext({ last: true, index: 0, count: 1 });

export const useRowPosition = () => use(RowPosition);

/** Gives each child row its position in the section. */
export function rowsWithPosition(children: ReactNode) {
	const rows = Children.toArray(children);
	return rows.map((row, index) => (
		<RowPosition
			key={isValidElement(row) ? row.key : index}
			value={{
				last: index === rows.length - 1,
				index,
				count: rows.length,
			}}
		>
			{row}
		</RowPosition>
	));
}
