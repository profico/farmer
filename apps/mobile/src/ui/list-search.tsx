import { Platform, View } from "react-native";

import { SearchField } from "../workspace/components";
import { Field } from "./field";
import { SPACE } from "./type";

/**
 * The search box above a list, inside an `Inset`. iOS draws the same
 * search field as the Clients, Tasks and People lists. Android keeps the
 * outlined field.
 */
export function ListSearch({
	label,
	value,
	onChangeText,
	placeholder,
}: {
	label: string;
	value: string;
	onChangeText: (value: string) => void;
	placeholder: string;
}) {
	if (Platform.OS === "ios") {
		// `SearchField` has its own side margin, so it takes back the one
		// of the `Inset` around it.
		return (
			<View style={{ marginHorizontal: -SPACE.l }}>
				<SearchField
					value={value}
					onChangeText={onChangeText}
					placeholder={placeholder}
				/>
			</View>
		);
	}
	return (
		<Field
			label={label}
			value={value}
			onChangeText={onChangeText}
			placeholder={placeholder}
			autoCorrect={false}
			clearButtonMode="while-editing"
		/>
	);
}
