import { isUploadedFile } from "@farmer/core/lib/uploads";

import { cn } from "#/lib/utils.ts";

// A project's mark, wherever the project appears: its emoji or uploaded image
// on the quiet ground, or — with neither chosen — the first letter of its name. It
// replaced a color dot, which told five projects in a list apart from each
// other about as well as five shades of the same purple do.
const SIZES = {
	sm: "size-7 rounded-md text-base",
	default: "size-12 rounded-lg text-2xl",
	lg: "size-[72px] rounded-xl text-[40px]",
} as const;

const LETTER = {
	sm: "text-xs",
	default: "text-lg",
	lg: "text-2xl",
} as const;

export function ProjectIcon({
	icon,
	name,
	size = "default",
	className,
}: {
	icon: string | null | undefined;
	name: string;
	size?: keyof typeof SIZES;
	className?: string;
}) {
	return (
		<span
			aria-hidden
			className={cn(
				"inline-grid shrink-0 place-items-center overflow-hidden border border-line2 bg-secondary leading-none select-none",
				SIZES[size],
				className,
			)}
		>
			{isUploadedFile(icon) ? (
				<img
					src={icon}
					alt=""
					draggable={false}
					className="size-full object-contain"
				/>
			) : icon ? (
				icon
			) : (
				<span className={cn("font-medium text-muted-foreground", LETTER[size])}>
					{name.trim().charAt(0).toUpperCase() || "?"}
				</span>
			)}
		</span>
	);
}
