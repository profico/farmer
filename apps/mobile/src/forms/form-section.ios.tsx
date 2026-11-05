import { View } from "react-native";

import { SPACE } from "../ui/type";
import { FormGroup, GroupCaption } from "./form-group";
import type { FormSectionProps } from "./form-section";

/** A labelled group inside a sheet: the inset grouped section of a native
 *  form, with the label above it in small capitals. A loose section has
 *  no title, and each control in it draws its own group. */
export function FormSection({
	label,
	footer,
	footerError,
	loose,
	children,
}: FormSectionProps) {
	if (loose) {
		return (
			<View style={{ gap: SPACE.m }}>
				{children}
				{footer ? (
					<GroupCaption error={footerError}>{footer}</GroupCaption>
				) : null}
			</View>
		);
	}
	return (
		<FormGroup title={label} footer={footer} footerError={footerError}>
			{children}
		</FormGroup>
	);
}
