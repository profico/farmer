import type { ColorValue } from "react-native";

import { Text } from "./components";

export type FigureProps = {
	/** The text to show, for example "7:30 logged". */
	text: string;
	/** The number behind the text. A change of it rolls the digits on iOS. */
	value: number;
	color?: ColorValue;
};

/** A number that changes after a write, such as the total of a day. */
export function Figure({ text, color }: FigureProps) {
	return (
		<Text variant="titleMedium" color={color} numeric>
			{text}
		</Text>
	);
}
