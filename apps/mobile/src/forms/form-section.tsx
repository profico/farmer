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
	children: ReactNode;
};

/** A labelled group inside a sheet. */
export function FormSection({
	label,
	footer,
	footerError,
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
