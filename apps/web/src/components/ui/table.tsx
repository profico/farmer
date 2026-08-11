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
	...props
}: React.ComponentProps<"table"> & {
	containerClassName?: string;
	/**
	 * Off for a table inside a pane that already reaches its container's edge
	 * (the close screen's two panes), where bleeding again would pull it out of
	 * the pane entirely. Gutters still apply.
	 */
	bleed?: boolean;
}) {
	return (
		<div
			data-slot="table-container"
			className={cn(
				"relative overflow-x-auto",
				bleed && "-mx-4 border-y sm:-mx-8",
				containerClassName,
			)}
		>
			<table
				data-slot="table"
				className={cn(
					"w-full caption-bottom text-base",
					"[&>*>tr>:first-child]:pl-4 [&>*>tr>:last-child]:pr-4 sm:[&>*>tr>:first-child]:pl-8 sm:[&>*>tr>:last-child]:pr-8",
					className,
				)}
				{...props}
			/>
		</div>
	);
}

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

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
	return (
		<td
			data-slot="table-cell"
			className={cn(
				"px-2 py-2.5 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
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
};
