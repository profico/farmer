import { ICONS, type IconName } from "../ui/icons";
import type { WorkspaceIconName } from "../workspace/icons";

/** One button at the end of a navigation header. */
export type HeaderAction = {
	/** The icon. A button with no icon shows its label as text. */
	icon?: IconName | WorkspaceIconName;
	/** The name of the button: read out by a screen reader, and shown when
	 *  the button has no icon. */
	label: string;
	onPress: () => void;
	disabled?: boolean;
	/** iOS: the bold, tinted bar button of the main action, such as Save. */
	prominent?: boolean;
};

/** Whether an icon is one of `src/ui/icons.ts`, and not only of the
 *  workspace set. */
export const isKitIcon = (name: string): name is IconName => name in ICONS;
