import type * as React from "react";

import { cn } from "#/lib/utils.ts";

function Label({ className, ...props }: React.ComponentProps<"label">) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: generic primitive, htmlFor/children come from consumers via ...props
		<label
			data-slot="label"
			className={cn(
				// A field's label is a caption, not a heading: same size as the
				// smallest reading text, muted, and never bold enough to compete
				// with the value underneath it.
				"flex items-center gap-2 text-sm leading-none font-medium text-muted-foreground select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}

export { Label };
