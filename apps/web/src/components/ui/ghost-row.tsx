import { PlusIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * The row a list ends on: quiet, boxless, and the "add" action itself.
 *
 * It replaces the centred `EmptyState` on the two screens that fill a day. An
 * empty day is a sentence and this same row, so a screen with nothing on it
 * still has somewhere to start — and a screen with twelve rows on it ends on
 * the way to a thirteenth rather than sending the reader back to a button in
 * the header.
 *
 * A button, not a link, because everywhere it appears it opens a dialog on the
 * same screen. `hint` sits at the far right for a shortcut or a note.
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
				"flex w-full items-center gap-2.5 rounded-md py-3 text-left text-sm text-faint transition-colors duration-(--dur-base) outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:size-4 [&_svg]:shrink-0",
				className,
			)}
		>
			{icon}
			<span className="min-w-0 flex-1">{children}</span>
			{hint && <span className="text-xs text-faint">{hint}</span>}
		</button>
	);
}
