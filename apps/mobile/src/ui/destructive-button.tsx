import { View } from "react-native";

import { ActionButton } from "./action-button";

export type DestructiveButtonProps = {
	label: string;
	onPress: () => void;
	disabled?: boolean;
};

/**
 * A button for an action that deletes something. On iOS it is a red row
 * (`destructive-button.ios.tsx`). Android draws a text button in the error
 * colour.
 */
export function DestructiveButton({
	label,
	onPress,
	disabled,
}: DestructiveButtonProps) {
	return (
		<View style={{ flexDirection: "row" }}>
			<ActionButton
				label={label}
				variant="text"
				tone="error"
				onPress={onPress}
				disabled={disabled}
			/>
		</View>
	);
}
