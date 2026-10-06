import type { RowMenuItem } from "./row-menu-items";

export type RowMenuSheetProps = {
	title: string;
	items: RowMenuItem[];
	onClose: () => void;
};

/** iOS opens the action sheet of the system from the provider, so there is
 *  no sheet to draw. Android draws a bottom sheet (`row-menu-sheet.android.tsx`). */
export function RowMenuSheet(_props: RowMenuSheetProps) {
	return null;
}
