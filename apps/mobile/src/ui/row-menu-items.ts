import type { IconName } from "./icons";

/** One action in the menu of a row. */
export type RowMenuItem = {
	label: string;
	icon: IconName;
	/** A destructive item is drawn in the error colour, after the rest. */
	destructive?: boolean;
	onPress: () => void;
};

/** What a caller may put in a list of items. A `false` stands for an action
 *  that the person may not do: `can && item` keeps the line short. */
export type RowMenuEntry = RowMenuItem | false | null | undefined;

/**
 * The items to show: the entries that are items, with the destructive ones
 * last. The order inside each group does not change. A caller that finds
 * the person may not do an action leaves that item out, so the menu never
 * shows it.
 */
export const menuItemsOf = (entries: readonly RowMenuEntry[]) => {
	const items = entries.filter((entry): entry is RowMenuItem => Boolean(entry));
	return [
		...items.filter((item) => !item.destructive),
		...items.filter((item) => item.destructive),
	];
};
