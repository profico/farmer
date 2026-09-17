import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "#/lib/utils.ts";

// Focus is an accent border plus a soft ring rather than the platform outline,
// which lands as a hard blue rectangle on top of all this warm grey.
const FOCUS =
	"outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/16";

const buttonVariants = cva(
	`group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-(--dur-base) select-none ${FOCUS} active:not-aria-[haspopup]:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
	{
		variants: {
			variant: {
				// The app's one filled control. Everything else is a hairline or
				// a word, which is what keeps this one reading as *the* action.
				//
				// Disabled, it drops the fill entirely rather than fading it. A
				// half-opacity ember reads as an ember button behind frosted glass —
				// still the loudest thing on the page, and still inviting the click
				// it is refusing. Grey says "not yet" in one glance.
				default:
					"bg-primary text-primary-foreground hover:bg-[color-mix(in_srgb,var(--acc)_86%,var(--fg))] disabled:bg-[color-mix(in_srgb,var(--fg)_9%,transparent)] disabled:text-faint disabled:opacity-100",
				outline:
					"border-border bg-transparent hover:border-muted-foreground/60 hover:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-[color-mix(in_srgb,var(--bg2),var(--fg)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
				ghost:
					"text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
				// A tint, not a fill: even in a confirm dialog, the one place it is
				// used, an irreversible action sits at its neighbours' weight; the
				// words carry the warning, the tint confirms it.
				//
				// The hover text is pulled towards the foreground because red on
				// its own 16% tint is 4.2:1 on light paper, under the 4.5 a label
				// needs. Mixed, it is 5.0.
				destructive:
					"bg-destructive/8 text-destructive hover:bg-destructive/16 hover:text-[color-mix(in_srgb,var(--destructive)_86%,var(--fg))]",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default:
					"h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
				xs: "h-6 gap-1 rounded-md px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
				sm: "h-7 gap-1 rounded-md px-2.5 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
				lg: "h-9 gap-2 px-3.5 text-base has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
				icon: "size-8",
				"icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-7 rounded-md",
				"icon-lg": "size-9",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
	...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
	return (
		<ButtonPrimitive
			data-slot="button"
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
