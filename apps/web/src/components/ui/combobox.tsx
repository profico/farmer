"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import {
	CaretDownIcon,
	CheckIcon,
	MagnifyingGlassIcon,
} from "@phosphor-icons/react";

import { cn } from "#/lib/utils.ts";

// A Select you can type into. Same box, same popup and same item styling as
// `select.tsx`, plus a search field at the top of the popup — for the lists
// that are too long to scan (every project, grouped by client; every task,
// grouped). The trigger is a button that shows the chosen value, so it sits in
// a form exactly where a Select would; the search input lives in the popup and
// takes focus when it opens.
//
// Filtering is the caller's: pass `items` (flat, or groups of `{ value, label,
// items }`) and `filteredItems` computed with `matchesSearch` from
// `@farmer/core/lib/search`, so a picker folds accents the way every other list in the
// app does. `autoHighlight` keeps the first match ready for Enter.

const Combobox = ComboboxPrimitive.Root;
const ComboboxCollection = ComboboxPrimitive.Collection;

function ComboboxTrigger({
	className,
	size = "default",
	children,
	...props
}: ComboboxPrimitive.Trigger.Props & {
	size?: "sm" | "default";
}) {
	return (
		<ComboboxPrimitive.Trigger
			data-slot="combobox-trigger"
			data-size={size}
			className={cn(
				"flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-1 pr-2 pl-2.5 text-left text-base transition-[border-color,box-shadow] duration-(--dur-base) outline-none select-none hover:not-disabled:not-focus-visible:border-muted-foreground/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/16 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-popup-open:border-ring data-popup-open:ring-3 data-popup-open:ring-ring/16 data-[size=default]:min-h-8 data-[size=sm]:min-h-7 data-[size=sm]:rounded-md [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			{children}
			<ComboboxPrimitive.Icon
				render={
					<CaretDownIcon
						weight="regular"
						className="pointer-events-none size-4 text-muted-foreground"
					/>
				}
			/>
		</ComboboxPrimitive.Trigger>
	);
}

// `Value` renders no element of its own, so the box that truncates and stacks
// a two-line value (client over project) is here.
function ComboboxValue({
	className,
	...props
}: ComboboxPrimitive.Value.Props & { className?: string }) {
	return (
		<span
			data-slot="combobox-value"
			className={cn(
				"flex min-w-0 flex-1 flex-col text-left leading-tight",
				className,
			)}
		>
			<ComboboxPrimitive.Value {...props} />
		</span>
	);
}

function ComboboxContent({
	className,
	children,
	side = "bottom",
	sideOffset = 4,
	align = "start",
	alignOffset = 0,
	searchPlaceholder = "Search…",
	...props
}: ComboboxPrimitive.Popup.Props &
	Pick<
		ComboboxPrimitive.Positioner.Props,
		"align" | "alignOffset" | "side" | "sideOffset"
	> & {
		/** `false` for a list short enough to need no search box. */
		searchPlaceholder?: string | false;
	}) {
	return (
		<ComboboxPrimitive.Portal>
			<ComboboxPrimitive.Positioner
				side={side}
				sideOffset={sideOffset}
				align={align}
				alignOffset={alignOffset}
				className="isolate z-50 outline-none"
			>
				<ComboboxPrimitive.Popup
					data-slot="combobox-content"
					className={cn(
						"relative isolate z-50 flex max-h-(--available-height) w-(--anchor-width) min-w-56 origin-(--transform-origin) flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-[var(--shadow-pop)] outline-none duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
						className,
					)}
					{...props}
				>
					{searchPlaceholder !== false && (
						<div className="relative shrink-0 border-b border-line2 p-1.5">
							<MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-faint" />
							<ComboboxPrimitive.Input
								placeholder={searchPlaceholder}
								aria-label={searchPlaceholder}
								className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent py-1 pr-2.5 pl-8 text-base outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/16"
							/>
						</div>
					)}
					{children}
				</ComboboxPrimitive.Popup>
			</ComboboxPrimitive.Positioner>
		</ComboboxPrimitive.Portal>
	);
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
	return (
		<ComboboxPrimitive.List
			data-slot="combobox-list"
			className={cn(
				"scroll-py-1 overflow-y-auto p-1 outline-none empty:hidden",
				className,
			)}
			{...props}
		/>
	);
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
	return (
		<ComboboxPrimitive.Group
			data-slot="combobox-group"
			className={cn("scroll-my-1", className)}
			{...props}
		/>
	);
}

function ComboboxGroupLabel({
	className,
	...props
}: ComboboxPrimitive.GroupLabel.Props) {
	return (
		<ComboboxPrimitive.GroupLabel
			data-slot="combobox-group-label"
			className={cn("eyebrow px-2 pt-2 pb-1.5", className)}
			{...props}
		/>
	);
}

function ComboboxItem({
	className,
	children,
	...props
}: ComboboxPrimitive.Item.Props) {
	return (
		<ComboboxPrimitive.Item
			data-slot="combobox-item"
			className={cn(
				"relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 pr-8 text-base outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			{children}
			<ComboboxPrimitive.ItemIndicator
				render={
					<span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
				}
			>
				<CheckIcon weight="regular" className="pointer-events-none" />
			</ComboboxPrimitive.ItemIndicator>
		</ComboboxPrimitive.Item>
	);
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
	return (
		<ComboboxPrimitive.Empty
			data-slot="combobox-empty"
			className={cn(
				"px-2 py-6 text-center text-sm text-muted-foreground empty:hidden",
				className,
			)}
			{...props}
		/>
	);
}

export {
	Combobox,
	ComboboxCollection,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxGroup,
	ComboboxGroupLabel,
	ComboboxItem,
	ComboboxList,
	ComboboxTrigger,
	ComboboxValue,
};
