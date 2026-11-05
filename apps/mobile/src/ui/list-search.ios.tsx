import { View } from "react-native";

import type { ListSearchProps } from "./list-search";
import { SearchField } from "./search-field";
import { SPACE } from "./type";

/** The search field of iOS. It draws no label: the placeholder names it. */
export function ListSearch({
	value,
	onChangeText,
	placeholder,
}: ListSearchProps) {
	// `SearchField` has its own side margin, so it takes back the one of the
	// `Inset` around it.
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
