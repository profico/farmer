import { type ReactNode, use } from "react";
import { Text, View } from "react-native";

import { rowsWithPosition } from "../ui/settings-list.shared";
import { usePalette } from "../ui/theme";
import { SPACE, TYPE } from "../ui/type";
import { InFormGroup } from "./form-context";
import type { FormGroupProps } from "./form-group";

const ROW_INSET = SPACE.l;

/** The small text above or under a group: a title in capitals, a hint, or
 *  an error in red. */
export function GroupCaption({
	children,
	error,
}: {
	children: ReactNode;
	error?: boolean;
}) {
	const palette = usePalette();
	return (
		<View style={{ paddingHorizontal: ROW_INSET }}>
			<Text
				style={[
					TYPE.bodySmall,
					{ color: error ? palette.error : palette.onSurfaceVariant },
				]}
			>
				{children}
			</Text>
		</View>
	);
}

/** The inset grouped section of an iOS form: rounded rows on the raised
 *  surface, a hairline between rows, a title above and a footer under. The
 *  parent screen gives the side margin. */
export function FormGroup({
	title,
	footer,
	footerError,
	children,
}: FormGroupProps) {
	const palette = usePalette();
	return (
		<InFormGroup value>
			<View style={{ gap: 6 }}>
				{title ? <GroupCaption>{title.toUpperCase()}</GroupCaption> : null}
				<View
					style={{
						borderRadius: 10,
						overflow: "hidden",
						backgroundColor: palette.surfaceContainer,
					}}
				>
					{rowsWithPosition(children)}
				</View>
				{footer ? (
					<GroupCaption error={footerError}>{footer}</GroupCaption>
				) : null}
			</View>
		</InFormGroup>
	);
}

/** A control that stands alone makes its own group. In a `FormGroup` it
 *  draws only its row. */
export function GroupIfAlone({
	footer,
	footerError,
	children,
}: Pick<FormGroupProps, "footer" | "footerError" | "children">) {
	if (use(InFormGroup)) return children;
	return (
		<FormGroup footer={footer} footerError={footerError}>
			{children}
		</FormGroup>
	);
}
