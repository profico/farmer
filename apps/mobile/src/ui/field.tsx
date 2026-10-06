import {
	Platform,
	Text as RNText,
	TextInput,
	type TextInputProps,
	View,
} from "react-native";

import { usePalette } from "./theme";
import { SPACE, TYPE } from "./type";

export type FieldProps = TextInputProps & {
	label: string;
	hint?: string;
	error?: string | null;
	/** Android: the colour behind the field, which the floating label cuts
	 *  out of the outline. The default is the screen colour. */
	containerColor?: string;
};

/** A labelled text field, outlined. Android draws the floating label of
 *  Material 3 instead (`field.android.tsx`). */
export function Field({
	label,
	hint,
	error,
	containerColor: _containerColor,
	...input
}: FieldProps) {
	const palette = usePalette();
	return (
		<View style={{ gap: SPACE.xs }}>
			<RNText style={[TYPE.labelMedium, { color: palette.onSurfaceVariant }]}>
				{label}
			</RNText>
			<TextInput
				placeholderTextColor={palette.onSurfaceVariant}
				selectionColor={palette.primary}
				cursorColor={palette.primary}
				{...input}
				style={[
					TYPE.bodyLarge,
					{
						color: palette.onSurface,
						borderWidth: 1,
						borderColor: error ? palette.error : palette.outline,
						borderRadius: Platform.OS === "ios" ? 10 : 4,
						paddingHorizontal: SPACE.l,
						paddingVertical: SPACE.m,
						minHeight: input.multiline ? 88 : 52,
						textAlignVertical: input.multiline ? "top" : "center",
					},
				]}
			/>
			{error || hint ? (
				<RNText
					style={[
						TYPE.bodySmall,
						{ color: error ? palette.error : palette.onSurfaceVariant },
					]}
				>
					{error ?? hint}
				</RNText>
			) : null}
		</View>
	);
}
