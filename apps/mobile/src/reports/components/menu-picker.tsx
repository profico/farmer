import { Picker } from "@expo/ui";
import { View } from "react-native";

import { Text } from "../../ui/components";
import { ControlHost } from "../../ui/host";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";

export type MenuOption<T extends string> = { value: T; label: string };

/**
 * A choice of one value from a menu, with its label above it: the menu
 * button of iOS and the exposed dropdown menu of Material 3, through
 * `@expo/ui`. The value must be one of the options; a value that the person
 * cannot change still needs its option, with `enabled` false.
 */
export function MenuPicker<T extends string>({
	label,
	options,
	value,
	onChange,
	enabled = true,
}: {
	label: string;
	options: MenuOption<T>[];
	value: T;
	onChange: (value: T) => void;
	enabled?: boolean;
}) {
	const palette = usePalette();
	return (
		<View style={{ gap: SPACE.xs, alignItems: "flex-start" }}>
			<Text variant="labelMedium" color={palette.onSurfaceVariant}>
				{label}
			</Text>
			<ControlHost>
				<Picker
					selectedValue={value}
					onValueChange={(next) => {
						const picked = options.find((option) => option.value === next);
						if (picked) onChange(picked.value);
					}}
					enabled={enabled}
				>
					{options.map((option) => (
						<Picker.Item
							key={option.value}
							label={option.label}
							value={option.value}
						/>
					))}
				</Picker>
			</ControlHost>
		</View>
	);
}
