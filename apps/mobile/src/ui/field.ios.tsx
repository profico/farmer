import { PlatformColor, Text as RNText, TextInput } from "react-native";

import { GroupIfAlone } from "../forms/form-group";
import { FormRow } from "../forms/form-row";
import type { FieldProps } from "./field";
import { usePalette } from "./theme";
import { TYPE } from "./type";

/**
 * A text field as a row of an inset grouped form. A single line has its
 * label at the start, as in iOS Settings. A note has its own row with the
 * label as the placeholder. A hint or an error is the footer under the
 * group, and an error is red.
 */
export function Field({
	label,
	hint,
	error,
	containerColor: _containerColor,
	...input
}: FieldProps) {
	const palette = usePalette();
	const multiline = Boolean(input.multiline);
	const secure = Boolean(input.secureTextEntry);
	return (
		<GroupIfAlone footer={error ?? hint} footerError={Boolean(error)}>
			<FormRow tall={multiline}>
				{multiline ? null : (
					<RNText
						numberOfLines={1}
						style={[TYPE.bodyLarge, { color: palette.onSurface, minWidth: 88 }]}
					>
						{label}
					</RNText>
				)}
				<TextInput
					accessibilityLabel={label}
					placeholderTextColor={PlatformColor("placeholderText")}
					selectionColor={palette.primary}
					clearButtonMode={multiline || secure ? "never" : "while-editing"}
					{...input}
					placeholder={input.placeholder ?? (multiline ? label : undefined)}
					style={[
						// No line height: a field with one pushes its text down.
						{ fontSize: TYPE.bodyLarge.fontSize },
						{
							flex: 1,
							color: palette.onSurface,
							paddingVertical: 0,
							minHeight: multiline ? 88 : 24,
							textAlignVertical: multiline ? "top" : "center",
						},
					]}
				/>
			</FormRow>
		</GroupIfAlone>
	);
}
