import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "#/lib/utils.ts";

// A badge is a label, not a button: uppercase-adjacent, quiet, and tinted from
// the palette rather than filled with it. The only loud one is `default`, which
// is reserved for a count you are meant to notice.
const badgeVariants = cva(
	"group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[background-color,color,border-color] duration-(--dur-base) focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/16 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground [a]:hover:bg-primary/85",
				secondary: "bg-muted text-muted-foreground [a]:hover:text-foreground",
				destructive:
					"bg-destructive/10 text-destructive focus-visible:ring-destructive/20 [a]:hover:bg-destructive/16",
				outline:
					"border-border text-muted-foreground [a]:hover:bg-muted [a]:hover:text-foreground",
				ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
				link: "text-primary underline-offset-4 hover:underline",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Badge({
	className,
	variant = "default",
	render,
	...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return useRender({
		defaultTagName: "span",
		props: mergeProps<"span">(
			{
				className: cn(badgeVariants({ variant }), className),
			},
			props,
		),
		render,
		state: {
			slot: "badge",
			variant,
		},
	});
}

export { Badge, badgeVariants };
