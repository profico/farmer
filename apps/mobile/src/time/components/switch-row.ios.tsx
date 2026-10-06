import { Switch } from "@expo/ui";
import { use } from "react";
import { View } from "react-native";

import { InFormGroup } from "../../forms/form-context";
import { GroupIfAlone } from "../../forms/form-group";
import { FormRow } from "../../forms/form-row";
import { Text } from "../../ui/components";
import { ControlHost } from "../../ui/host";
import { usePalette } from "../../ui/theme";
import type { SwitchRowProps } from "./switch-row";

/** A choice in a form, as a row of an inset grouped section: the title at
 *  the start and the system switch at the end. The description is the
 *  footer under the section. In a group with other rows it is a line under
 *  the title. */
export function SwitchRow({
	title,
	description,
	value,
	onValueChange,
	disabled,
}: SwitchRowProps) {
	const palette = usePalette();
	const grouped = use(InFormGroup);
	return (
		<GroupIfAlone footer={description}>
			<FormRow grouped={false}>
				<View style={{ flex: 1, opacity: disabled ? 0.6 : 1 }}>
					<Text variant="bodyLarge">{title}</Text>
					{grouped && description ? (
						<Text variant="bodySmall" color={palette.onSurfaceVariant}>
							{description}
						</Text>
					) : null}
				</View>
				<ControlHost>
					<Switch
						value={value}
						onValueChange={onValueChange}
						disabled={disabled}
					/>
				</ControlHost>
			</FormRow>
		</GroupIfAlone>
	);
}
