import { PlatformColor, View } from "react-native";

import { Text } from "../ui/components";
import { Icon } from "../ui/icon";
import { usePalette } from "../ui/theme";
import { GroupIfAlone } from "./form-group";
import { FormRow } from "./form-row";
import type { PickerFieldProps } from "./picker-field";

/**
 * A select field as a row of a form: the label at the start, the value in
 * the secondary colour at the end, and a chevron, as in iOS Settings. A
 * tap pushes the selector. The `leading` mark (a project icon) sits after
 * the value, next to the chevron, so the value text lines up with the
 * other rows.
 */
export function PickerField({
	label,
	title,
	subtitle,
	leading,
	empty,
	onPress,
}: PickerFieldProps) {
	const palette = usePalette();
	return (
		<GroupIfAlone>
			<FormRow
				onPress={onPress}
				accessibilityLabel={
					empty
						? `${label}, ${title}`
						: `${label}, ${title}${subtitle ? `, ${subtitle}` : ""}`
				}
			>
				<Text variant="bodyLarge" numberOfLines={1}>
					{label}
				</Text>
				<View
					style={{
						flex: 1,
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "flex-end",
						gap: 8,
					}}
				>
					<View style={{ flexShrink: 1, alignItems: "flex-end" }}>
						<Text
							variant="bodyLarge"
							color={palette.onSurfaceVariant}
							numberOfLines={1}
							align="right"
						>
							{title}
						</Text>
						{subtitle ? (
							<Text
								variant="bodySmall"
								color={palette.onSurfaceVariant}
								numberOfLines={1}
								align="right"
							>
								{subtitle}
							</Text>
						) : null}
					</View>
					{leading}
				</View>
				<Icon
					name="forward"
					size={13}
					weight="semibold"
					color={PlatformColor("tertiaryLabel")}
				/>
			</FormRow>
		</GroupIfAlone>
	);
}
