import { IconButton } from "./icon-button";
import { useOpenRowMenu } from "./row-menu";
import type { RowMenuEntry } from "./row-menu-items";

export type RowMoreMenuProps = {
	/** The name of the row, in the title of the menu and for a screen reader. */
	title: string;
	/** The same items as the long press menu of the row. */
	entries: readonly RowMenuEntry[];
};

/**
 * The "more" button at the end of a row. Android opens the bottom sheet of
 * the row. iOS opens a pull-down menu (`row-more-menu.ios.tsx`).
 */
export function RowMoreMenu({ title, entries }: RowMoreMenuProps) {
	const open = useOpenRowMenu();
	return (
		<IconButton
			icon="more"
			label={`Actions for ${title}`}
			onPress={() => open(title, entries)}
		/>
	);
}
