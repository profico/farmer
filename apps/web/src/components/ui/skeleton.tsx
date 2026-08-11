import { cn } from "#/lib/utils.ts";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton"
			className={cn("pulse-quiet rounded-md bg-line", className)}
			{...props}
		/>
	);
}

export { Skeleton };
