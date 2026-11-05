import { Children, cloneElement, isValidElement, type ReactNode } from "react";

import type { FormPartProps } from "./form-cluster";
import { FormGroup } from "./form-group";

export type { FormPartProps } from "./form-cluster";

/** A part only holds the rows and the footer of its cluster. */
export function FormPart(_props: FormPartProps) {
	return null;
}

const join = (lines: (string | undefined)[]) => {
	const text = lines.filter(Boolean).join(" ");
	return text === "" ? undefined : text;
};

/**
 * The parts of a cluster as one inset grouped section: the rows of every
 * part in order, with the footers of the parts joined under the group.
 */
export function FormCluster({
	children,
}: {
	tight?: boolean;
	children: ReactNode;
}) {
	const parts = Children.toArray(children).flatMap((child) =>
		isValidElement<FormPartProps>(child) ? [child.props] : [],
	);
	// Each part numbers its children from zero, so a key needs the part.
	const rows = parts.flatMap((part, index) =>
		Children.toArray(part.children).map((row) =>
			isValidElement(row)
				? cloneElement(row, { key: `${index}${row.key ?? ""}` })
				: row,
		),
	);
	if (rows.length === 0) return null;
	return (
		<FormGroup
			footer={join(parts.flatMap((part) => [part.footer, part.groupFooter]))}
			footerError={parts.some((part) => part.footerError)}
		>
			{rows}
		</FormGroup>
	);
}
