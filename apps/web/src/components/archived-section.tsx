import { CaretDownIcon } from "@phosphor-icons/react";
import type * as React from "react";

import { TableCell, TableRow } from "#/components/ui/table.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * A closed-by-default disclosure for the archived rows below an active list.
 * Renders as a row inside the caller's own `<TableBody>`, so it shares the
 * table's columns, borders and hover style rather than starting a second
 * table.
 *
 * The open state is owned by the caller (usually the `?archived=1` search
 * param — see `$orgSlug/projects/index.tsx` for the pattern), so a reload or
 * the Back button keeps it open, and a search that only matches archived rows
 * can force it open too.
 */
export function ArchivedSection({
	count,
	colSpan,
	open,
	onOpenChange,
	children,
}: {
	count: number;
	colSpan: number;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: React.ReactNode;
}) {
	if (count === 0) return null;

	return (
		<>
			<TableRow className="hover:bg-transparent">
				<TableCell colSpan={colSpan} className="p-0">
					<button
						type="button"
						aria-expanded={open}
						onClick={() => onOpenChange(!open)}
						className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left text-sm text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground sm:px-8"
					>
						<CaretDownIcon
							weight="bold"
							className={cn(
								"size-3 shrink-0 transition-transform duration-(--dur-fast)",
								open && "rotate-180",
							)}
						/>
						Archived ({count})
					</button>
				</TableCell>
			</TableRow>
			{open && children}
		</>
	);
}
