import type { ReactNode } from "react";
import { View } from "react-native";

import { Text } from "../ui/components";
import { usePalette } from "../ui/theme";
import { FormGroup } from "./form-group";
import { FormRow } from "./form-row";
import type { PickerRowProps } from "./picker-row";

/** One row of a selector: a mark, the title with a second line, and the
 *  check at the end of the chosen row. */
export function PickerRow({
	leading,
	title,
	subtitle,
	trailing,
	onPress,
	selected,
}: PickerRowProps) {
	const palette = usePalette();
	return (
		<FormRow
			onPress={onPress}
			selected={selected}
			accessibilityLabel={[title, subtitle].filter((part) => part).join(", ")}
		>
			{leading}
			<View style={{ flex: 1 }}>
				<Text variant="bodyLarge" numberOfLines={1}>
					{title}
				</Text>
				{subtitle ? (
					<Text
						variant="bodySmall"
						color={palette.onSurfaceVariant}
						numberOfLines={1}
					>
						{subtitle}
					</Text>
				) : null}
			</View>
			{trailing}
		</FormRow>
	);
}

/** A list of rows as an inset grouped section, with a title above it. */
export function PickerRows({
	title,
	children,
}: {
	title?: string;
	children: ReactNode;
}) {
	return <FormGroup title={title}>{children}</FormGroup>;
}
