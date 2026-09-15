"use client";

import type * as React from "react";

import { cn } from "#/lib/utils.ts";

/**
 * A table spans its island edge to edge, and its outer columns line up with the
 * island's own padding — so the rules above and below it terminate on the
 * island's corners and the first column sits under the heading above it.
 *
 * That geometry lives here rather than at the call sites. It used to be written
 * out by hand in ten places and had split into two dialects: five screens
 * carried the full `-mx-4 border-y sm:-mx-8` bleed plus `pl-8` gutters, while
 * Clients, Tasks and Hour fund wrapped a bare `<Table>` in a bleeding div and so
 * kept the default `px-2` cells — their first column landed 8px off the island
 * edge instead of 32px, which is the "way nicer padding" difference between
 * those screens and Holidays.
 */
function Table({
	className,
	containerClassName,
	bleed = true,
	stickyHeader = false,
	...props
}: React.ComponentProps<"table"> & {
	containerClassName?: string;
	/**
	 * Off for a table inside a pane that already reaches its container's edge
	 * (the close screen's two panes, a `TableScroll`), where bleeding again
	 * would pull it out of the pane entirely. Gutters still apply.
	 */
	bleed?: boolean;
	/**
	 * Keeps the column labels in view inside a `TableScroll`. The container
	 * then does not scroll sideways by itself: a scroll container between the
	 * header cells and the scroller becomes what they stick to, and it never
	 * scrolls vertically, so nothing would stick. A wide table scrolls sideways
	 * with the `TableScroll` instead, labels and all.
	 *
	 * The rules above and below the labels are shadows on the header cells, so
	 * the container takes `border-b` only. A collapsed border belongs to the
	 * table and stays where it was drawn, and the container's own top border
	 * scrolled away with the first row.
	 */
	stickyHeader?: boolean;
}) {
	return (
		<div
			data-slot="table-container"
			className={cn(
				"relative",
				!stickyHeader && "overflow-x-auto",
				bleed && "-mx-4 border-y sm:-mx-8",
				containerClassName,
			)}
		>
			<table
				data-slot="table"
				className={cn(
					"w-full caption-bottom text-base",
					"[&>*>tr>:first-child]:pl-4 [&>*>tr>:last-child]:pr-4 sm:[&>*>tr>:first-child]:pl-8 sm:[&>*>tr>:last-child]:pr-8",
					stickyHeader &&
						"[&>thead_th]:sticky [&>thead_th]:top-0 [&>thead_th]:z-20 [&>thead_th]:bg-background [&>thead_th]:shadow-[inset_0_1px_0_var(--color-border),inset_0_-1px_0_var(--color-border)]",
					className,
				)}
				{...props}
			/>
		</div>
	);
}

/**
 * The scroll area of a full-height screen where only the table moves: the page
 * heading above it stays put, and a `stickyHeader` table inside keeps its
 * column labels in view. Pair it with `PageFull` and a `shrink-0` `PageHeader`.
 *
 * It bleeds to the island's edge itself, so a table inside takes
 * `bleed={false}` and its own rules (`border-b` with a `stickyHeader`,
 * `border-y` without). On a phone the island is not
 * height-capped, so this grows with its rows and the document scrolls.
 *
 * The bottom bleeds too, and gives the island's padding back inside: rows then
 * run under the island's bottom edge instead of being cut off a padding's
 * height above it, and the end of the list still has room below its last row.
 * The values are `island-pad`'s (1rem, then 1.75rem from `sm`).
 */
function TableScroll({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="table-scroll"
			className={cn(
				"-mx-4 -mb-4 min-h-0 flex-1 overflow-y-auto pb-4 sm:-mx-8 sm:-mb-7 sm:pb-7",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * For the cells of a body row that stays under a `stickyHeader` while its rows
 * go by: a group heading, the archived toggle. On the cells, because a sticky
 * cell works in every browser and a sticky row does not.
 *
 * It sticks 2px higher than `TableHead`'s `h-9`, under the header (which is
 * above it, `z-20`). Rows sit at fractional offsets, and exactly `top-9` left
 * a sliver of the row behind showing between the labels and the heading at
 * some scroll positions. The 2px it loses is top padding.
 *
 * A sticky cell is held back by the whole table, not by its group, so each one
 * stays until the table ends. The next one slides over it (a later row paints
 * on top), which is the hand-over from one group to the next — hence the
 * opaque background.
 */
const stickyRowCellClass = "sticky top-[calc(2.25rem-2px)] z-10 bg-background";

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
	return (
		<thead
			data-slot="table-header"
			className={cn(
				"[&_tr]:border-b [&_tr]:border-border [&_tr]:hover:bg-transparent",
				className,
			)}
			{...props}
		/>
	);
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
	return (
		<tbody
			data-slot="table-body"
			className={cn("[&_tr:last-child]:border-0", className)}
			{...props}
		/>
	);
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
	return (
		<tfoot
			data-slot="table-footer"
			className={cn("border-t font-medium [&>tr]:last:border-b-0", className)}
			{...props}
		/>
	);
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
	return (
		<tr
			data-slot="table-row"
			className={cn(
				"border-b border-line2 transition-colors duration-(--dur-fast) hover:bg-muted has-aria-expanded:bg-muted data-[state=selected]:bg-muted",
				className,
			)}
			{...props}
		/>
	);
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
	return (
		<th
			data-slot="table-head"
			className={cn(
				"eyebrow h-9 px-2 text-left align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * The vertical padding is `--table-cell-py` when "Compact tables" sets it (see
 * `styles.css`), and `py-2.5` otherwise. A `py-*` from the call site still
 * replaces it, so a cell with its own spacing is not compacted.
 */
function TableCell({ className, ...props }: React.ComponentProps<"td">) {
	return (
		<td
			data-slot="table-cell"
			className={cn(
				"px-2 py-[var(--table-cell-py,0.625rem)] align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
				className,
			)}
			{...props}
		/>
	);
}

function TableCaption({
	className,
	...props
}: React.ComponentProps<"caption">) {
	return (
		<caption
			data-slot="table-caption"
			className={cn("mt-4 text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

export {
	Table,
	TableHeader,
	TableBody,
	TableFooter,
	TableHead,
	TableRow,
	TableCell,
	TableCaption,
	TableScroll,
	stickyRowCellClass,
};
