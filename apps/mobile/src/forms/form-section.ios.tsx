import { FormGroup } from "./form-group";
import type { FormSectionProps } from "./form-section";

/** A labelled group inside a sheet: the inset grouped section of a native
 *  form, with the label above it in small capitals. */
export function FormSection({
	label,
	footer,
	footerError,
	children,
}: FormSectionProps) {
	return (
		<FormGroup title={label} footer={footer} footerError={footerError}>
			{children}
		</FormGroup>
	);
}
