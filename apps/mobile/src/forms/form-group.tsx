import type { ReactNode } from "react";

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
