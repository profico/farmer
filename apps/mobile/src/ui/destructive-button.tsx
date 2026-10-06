import { ActionButton } from "./action-button";

export type DestructiveButtonProps = {
	label: string;
	onPress: () => void;
	disabled?: boolean;
};

/**
 * A button for an action that deletes something. On iOS it is red
 * (`destructive-button.ios.tsx`). Android keeps the plain text button.
 */
export function DestructiveButton({
	label,
	onPress,
	disabled,
}: DestructiveButtonProps) {
	return (
		<ActionButton
			label={label}
			variant="text"
			onPress={onPress}
			disabled={disabled}
		/>
	);
}
