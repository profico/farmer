import { PlusIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * The row a list ends on: dashed, quiet, and the "add" action itself
 * (DESIGN.md, "Empty and ghost rows"). An empty list is a sentence and this
 * same row, so a screen with nothing on it still has somewhere to start.
 *
 * A button, not a link, because everywhere it appears it opens a dialog on
 * the same screen. `hint` sits at the far right for a shortcut or a note.
 */
export function GhostRow({
	children,
	hint,
	onClick,
	icon = <PlusIcon weight="bold" />,
	className,
}: {
	children: ReactNode;
	hint?: ReactNode;
	onClick?: () => void;
	icon?: ReactNode;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex w-full items-center gap-2.5 rounded-lg border border-dashed border-line px-3 py-2.5 text-left text-sm text-faint transition-[color,background-color,border-color] duration-(--dur-base) outline-none hover:border-transparent hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/16 [&_svg]:size-4 [&_svg]:shrink-0",
				className,
			)}
		>
			{icon}
			<span className="min-w-0 flex-1">{children}</span>
			{hint && <span className="text-xs text-faint">{hint}</span>}
		</button>
	);
}
