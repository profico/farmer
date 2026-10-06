import { Picker } from "@expo/ui";

import { ControlHost } from "./host";

export type MenuControlProps<T extends string> = {
	options: { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
	enabled: boolean;
	/** Android: the field fills the width of the form. iOS keeps the menu
	 *  button of the system, which is as wide as its value. */
	fill: boolean;
};

/**
 * The native menu of one value, through `@expo/ui`: the menu button of iOS.
 * Android draws the exposed dropdown menu of Material 3
 * (`menu-control.android.tsx`).
 */
export function MenuControl<T extends string>({
	options,
	value,
	onChange,
	enabled,
}: MenuControlProps<T>) {
	return (
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
	);
}
