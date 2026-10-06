import { Platform, View } from "react-native";

import { Text } from "../../ui/components";
import { MenuControl } from "../../ui/menu-control";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";

export type MenuOption<T extends string> = { value: T; label: string };

/**
 * A choice of one value from a menu, with its label above it: the menu
 * button of iOS and the exposed dropdown menu of Material 3
 * (`ui/menu-control`). The value must be one of the options; a value that
 * the person cannot change still needs its option, with `enabled` false.
 * On Android the label floats on the field. In a form, `fill` makes the Android field as wide as the other fields.
 */
export function MenuPicker<T extends string>({
	label,
	options,
	value,
	onChange,
	enabled = true,
	fill = false,
	inline = false,
}: {
	label: string;
	options: MenuOption<T>[];
	value: T;
	onChange: (value: T) => void;
	enabled?: boolean;
	fill?: boolean;
	/** iOS: the label stands beside the menu, which shows its value, as the
	 *  row of a settings list does. Android ignores it. */
	inline?: boolean;
}) {
	const palette = usePalette();
	if (inline && Platform.OS === "ios") {
		return (
			<View
				style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}
			>
				<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
					{label}
				</Text>
				<MenuControl
					options={options}
					value={value}
					onChange={onChange}
					enabled={enabled}
					fill={fill}
					label={label}
				/>
			</View>
		);
	}
	return (
		<View
			style={{ gap: SPACE.xs, alignItems: fill ? "stretch" : "flex-start" }}
		>
			{Platform.OS === "android" ? null : (
				<Text variant="labelMedium" color={palette.onSurfaceVariant}>
					{label}
				</Text>
			)}
			<MenuControl
				options={options}
				value={value}
				onChange={onChange}
				enabled={enabled}
				fill={fill}
				label={label}
			/>
		</View>
	);
}
