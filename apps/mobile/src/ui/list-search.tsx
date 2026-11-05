import { Field } from "./field";

export type ListSearchProps = {
	label: string;
	value: string;
	onChangeText: (value: string) => void;
	placeholder: string;
};

/**
 * The search box above a list, inside an `Inset`. Android keeps the
 * outlined field. iOS draws the search field of the Clients, Tasks and
 * People lists (`list-search.ios.tsx`).
 */
export function ListSearch({
	label,
	value,
	onChangeText,
	placeholder,
}: ListSearchProps) {
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
