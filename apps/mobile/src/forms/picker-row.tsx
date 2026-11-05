import type { ComponentProps, ReactNode } from "react";
import { View } from "react-native";

import { ListRow } from "../ui/components";
import { usePalette } from "../ui/theme";

export type PickerRowProps = Pick<
	ComponentProps<typeof ListRow>,
	"leading" | "title" | "subtitle" | "trailing" | "onPress" | "selected"
>;

/** One row of a selector. Android draws the list row of Material.
 *  iOS draws a row of an inset grouped list (`picker-row.ios.tsx`). */
export function PickerRow(props: PickerRowProps) {
	return <ListRow {...props} />;
}

/** A list of rows on one surface, in a form. Use it in a loose
 *  `FormSection`. iOS draws an inset grouped section with the title above
 *  it (`picker-row.ios.tsx`). Android draws a card, and the section has the
 *  title. */
export function PickerRows({
	children,
}: {
	title?: string;
	children: ReactNode;
}) {
	const palette = usePalette();
	return (
		<View
			style={{
				borderRadius: 16,
				overflow: "hidden",
				backgroundColor: palette.surfaceContainer,
			}}
		>
			{children}
		</View>
	);
}
