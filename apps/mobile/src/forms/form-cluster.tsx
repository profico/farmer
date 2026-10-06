import type { ReactNode } from "react";
import { View } from "react-native";

import { SPACE } from "../ui/type";
import { FormSection } from "./form-section";

/**
 * One part of a cluster. Android draws each part as its own labelled
 * section. iOS draws all parts of a cluster as rows of one inset grouped
 * section (`form-cluster.ios.tsx`), as a native form groups related rows.
 */
export type FormPartProps = {
	/** Android: the label of the section. A part with no label draws its
	 *  controls bare, as they stand in the form. */
	label?: string;
	/** Under the section on Android, and under the group on iOS. */
	footer?: string;
	footerError?: boolean;
	/** iOS only: a line under the group, where Android shows the same
	 *  information in the content of the part. */
	groupFooter?: string;
	children: ReactNode;
};

export function FormPart({
	label,
	footer,
	footerError,
	children,
}: FormPartProps) {
	if (!label) return <>{children}</>;
	return (
		<FormSection label={label} footer={footer} footerError={footerError} loose>
			{children}
		</FormSection>
	);
}

/** A set of related parts. Android keeps the parts apart. With `tight`,
 *  Android stacks them close together in one column. */
export function FormCluster({
	tight,
	children,
}: {
	tight?: boolean;
	children: ReactNode;
}) {
	if (tight) return <View style={{ gap: SPACE.m }}>{children}</View>;
	return <>{children}</>;
}
