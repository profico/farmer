import { Switch } from "@expo/ui";
import { View } from "react-native";

import { Text } from "../../ui/components";
import { ControlHost } from "../../ui/host";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";

/** A choice in a form: its words on the left and the system switch on the
 *  right. A screen reader reads the words, then the switch. */
export function SwitchRow({
	title,
	description,
	value,
	onValueChange,
	disabled,
}: {
	title: string;
	description?: string;
	value: boolean;
	onValueChange: (value: boolean) => void;
	disabled?: boolean;
}) {
	const palette = usePalette();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: SPACE.m,
				opacity: disabled ? 0.6 : 1,
			}}
		>
			<View style={{ flex: 1 }}>
				<Text variant="bodyLarge">{title}</Text>
				{description ? (
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
		</View>
	);
}
