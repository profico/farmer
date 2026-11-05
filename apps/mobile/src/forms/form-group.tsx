import type { ReactNode } from "react";

import { Text } from "../ui/components";
import { usePalette } from "../ui/theme";

/**
 * A set of form rows on one surface. iOS draws the inset grouped section
 * of a native form (`form-group.ios.tsx`). On Android the controls draw
 * themselves, so the group adds nothing.
 */
export type FormGroupProps = {
	title?: string;
	/** A line under the group, for a hint or an error. */
	footer?: string;
	footerError?: boolean;
	children: ReactNode;
};

export function FormGroup({ children }: FormGroupProps) {
	return <>{children}</>;
}

/** A control that stands alone on iOS makes its own group. Android has no
 *  group, so the control stands as it is. */
export function GroupIfAlone({
	children,
}: Pick<FormGroupProps, "footer" | "footerError" | "children">) {
	return <>{children}</>;
}

/** The small text above or under a group on iOS. */
export function GroupCaption({
	children,
	error,
}: {
	children: ReactNode;
	error?: boolean;
}) {
	const palette = usePalette();
	return (
		<Text
			variant="bodySmall"
			color={error ? palette.error : palette.onSurfaceVariant}
		>
			{children}
		</Text>
	);
}
