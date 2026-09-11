import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import type * as React from "react";

import { Input } from "#/components/ui/input.tsx";
import { TableCell, TableRow } from "#/components/ui/table.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * The filter box above a list. Every list screen spelled this out by hand —
 * icon, offset, padding — which is how two copies of it existed and every other
 * list had none. Filtering is the caller's (`matchesSearch`, `lib/search.ts`);
 * this is only the box.
 *
 * Escape clears it, so a filter that emptied the list is one key away from
 * gone. `className` sizes the wrapper; the input fills it.
 */
export function SearchInput({
	value,
	onValueChange,
	placeholder = "Search…",
	className,
	...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> & {
	value: string;
	onValueChange: (value: string) => void;
}) {
	return (
		<div className={cn("relative", className)}>
			<MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
			<Input
				type="search"
				aria-label={placeholder}
				placeholder={placeholder}
				value={value}
				onChange={(e) => onValueChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape" && value !== "") {
						e.preventDefault();
						onValueChange("");
					}
				}}
				className="w-full pl-8 [&::-webkit-search-cancel-button]:hidden"
				{...props}
			/>
		</div>
	);
}

/** The one row a filtered table shows when the search matched nothing. */
export function NoMatchesRow({
	colSpan,
	children = "Nothing matches your search.",
}: {
	colSpan: number;
	children?: React.ReactNode;
}) {
	return (
		<TableRow className="hover:bg-transparent">
			<TableCell colSpan={colSpan} className="text-muted-foreground">
				{children}
			</TableCell>
		</TableRow>
	);
}
