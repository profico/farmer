import type { ReactNode } from "react";
import { Platform, View } from "react-native";

import { Text } from "../ui/components";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";

export type FormSectionProps = {
	label: string;
	/** A line under the section, for a hint or an error. */
	footer?: string;
	footerError?: boolean;
	/** iOS: the controls in the section each draw their own group, and
	 *  the section draws no title. Use it for a section whose controls
	 *  carry their own labels. Android ignores it. */
	loose?: boolean;
	children: ReactNode;
};

/** A labelled group inside a sheet. */
export function FormSection({
	label,
	footer,
	footerError,
	loose: _loose,
	children,
}: FormSectionProps) {
	const palette = usePalette();
	return (
		<View style={{ gap: SPACE.s }}>
			{/* Android names a section as the Expressive settings lists do. */}
			{Platform.OS === "android" ? (
				<Text variant="titleSmallEmphasized" color={palette.primary}>
					{label}
				</Text>
			) : (
				<Text variant="labelLarge" color={palette.onSurfaceVariant}>
					{label}
				</Text>
			)}
			{children}
			{footer ? (
				<Text
					variant="bodySmall"
					color={footerError ? palette.error : palette.onSurfaceVariant}
				>
					{footer}
				</Text>
			) : null}
		</View>
	);
}
