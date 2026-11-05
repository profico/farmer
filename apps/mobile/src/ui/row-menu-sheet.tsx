import type { RowMenuItem } from "./row-menu-items";

export type RowMenuSheetProps = {
	title: string;
	items: RowMenuItem[];
	onClose: () => void;
};

/** iOS draws a context menu of the system on the row itself
 *  (`row-menu-target.ios.tsx`), so there is no sheet to draw. Android draws a
 *  bottom sheet (`row-menu-sheet.android.tsx`). */
export function RowMenuSheet(_props: RowMenuSheetProps) {
	return null;
}
