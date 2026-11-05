import type { IconName } from "../ui/icons";

/** One button at the end of a navigation header. */
export type HeaderAction = {
	/** The icon. A button with no icon shows its label as text. */
	icon?: IconName;
	/** The name of the button: read out by a screen reader, and shown when
	 *  the button has no icon. */
	label: string;
	onPress: () => void;
	disabled?: boolean;
	/** iOS: the bold, tinted bar button of the main action, such as Save. */
	prominent?: boolean;
};
