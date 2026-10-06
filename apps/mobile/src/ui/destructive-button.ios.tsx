import { Text } from "react-native";

import { GroupIfAlone } from "../forms/form-group";
import { FormRow } from "../forms/form-row";
import type { DestructiveButtonProps } from "./destructive-button";
import { usePalette } from "./theme";
import { TYPE } from "./type";

/** The red row of iOS for an action that deletes something: centred red
 *  text in a section of its own, as in Contacts and Calendar. */
export function DestructiveButton({
	label,
	onPress,
	disabled,
}: DestructiveButtonProps) {
	const palette = usePalette();
	return (
		<GroupIfAlone>
			<FormRow onPress={onPress} disabled={disabled} accessibilityLabel={label}>
				<Text
					style={[
						TYPE.bodyLarge,
						{
							flex: 1,
							textAlign: "center",
							color: palette.error,
							opacity: disabled ? 0.4 : 1,
						},
					]}
				>
					{label}
				</Text>
			</FormRow>
		</GroupIfAlone>
	);
}
