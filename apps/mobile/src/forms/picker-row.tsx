import type { ComponentProps } from "react";

import { ListRow } from "../ui/components";

export type PickerRowProps = Pick<
	ComponentProps<typeof ListRow>,
	"leading" | "title" | "subtitle" | "trailing" | "onPress" | "selected"
>;

/** One row of a selector. Android draws the list row of Material.
 *  iOS draws a row of an inset grouped list (`picker-row.ios.tsx`). */
export function PickerRow(props: PickerRowProps) {
	return <ListRow {...props} />;
}
