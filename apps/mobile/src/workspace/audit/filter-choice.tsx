import { useState } from "react";
import { View } from "react-native";

import { SettingsLink, SettingsSection } from "../../ui/settings-list";
import { SPACE } from "../../ui/type";
import { ChoiceSection, type Option } from "../components";

/**
 * A filter with a long list of values. The row shows the chosen value. A
 * press opens the list under the row, and a choice closes it. The first
 * option has the empty value and means "no filter".
 */
export function FilterChoice({
	title,
	options,
	value,
	onChange,
}: {
	title: string;
	options: readonly Option<string>[];
	value: string;
	onChange: (value: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const shown = options.find((option) => option.value === value)?.label;
	return (
		<View style={{ gap: SPACE.s }}>
			<SettingsSection>
				<SettingsLink
					title={title}
					value={shown ?? value}
					onPress={() => setOpen((current) => !current)}
				/>
			</SettingsSection>
			{open ? (
				<ChoiceSection
					options={options}
					value={value}
					onChange={(next) => {
						onChange(next);
						setOpen(false);
					}}
				/>
			) : null}
		</View>
	);
}
