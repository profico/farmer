import type { MoreAction } from "./more-menu";

/** Android draws these controls in the title row. iOS draws bar items
 *  (`time-toolbar.ios.tsx`). */
export function TimeToolbar(_props: {
	actions: MoreAction[];
	onAction: (id: string) => void;
	onLog: () => void;
}) {
	return null;
}
