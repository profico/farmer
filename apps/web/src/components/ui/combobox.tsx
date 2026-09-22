"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import {
	CaretDownIcon,
	CheckIcon,
	MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import {
	createContext,
	type RefObject,
	useContext,
	useRef,
	useState,
} from "react";

import { popupLayer } from "#/lib/popup-layer.ts";
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
// app does. `autoHighlight` keeps the first match ready for Enter; Tab takes a
// match only when it is the only one (Harvest's habit), which each picker
// decides through `onSearchTab` because the filtered list is the picker's.

// Which way the popup opens. Base UI's own collision handling flips the popup
// above the trigger whenever the list's NATURAL height does not fit below —
// and every project or task list is taller than the space under a dialog's
// footer, so "Pick a project" in File your time opened upwards, search box at
// the top of the screen and the list reading back down towards the trigger.
// The size middleware would have shrunk the list to the room below, but flip
// runs first and never sees that. So the side is decided here instead, once,
// as the popup opens: below unless the room below cannot hold the search box
// and a few rows, and flipping is switched off so the popup then sizes to the
// side it was given. A list too tall for the room scrolls, as a list should.
type PopupSide = "bottom" | "top";
const MIN_ROOM_BELOW_PX = 160;
const PopupSideContext = createContext<{
	side: PopupSide;
	trigger: RefObject<HTMLButtonElement | null>;
}>({ side: "bottom", trigger: { current: null } });

function Combobox<Value, Multiple extends boolean | undefined = false>({
	onOpenChange,
	...props
}: ComboboxPrimitive.Root.Props<Value, Multiple>) {
	const trigger = useRef<HTMLButtonElement | null>(null);
	const [side, setSide] = useState<PopupSide>("bottom");
	return (
		<PopupSideContext.Provider value={{ side, trigger }}>
			<ComboboxPrimitive.Root
				{...props}
				onOpenChange={(open, details) => {
					if (open && trigger.current) {
						const room =
							window.innerHeight -
							trigger.current.getBoundingClientRect().bottom;
						setSide(room >= MIN_ROOM_BELOW_PX ? "bottom" : "top");
					}
					onOpenChange?.(open, details);
				}}
			/>
		</PopupSideContext.Provider>
	);
}
const ComboboxCollection = ComboboxPrimitive.Collection;

function ComboboxTrigger({
	className,
	size = "default",
	children,
	...props
}: ComboboxPrimitive.Trigger.Props & {
	size?: "sm" | "default";
}) {
	const { trigger } = useContext(PopupSideContext);
	return (
		<ComboboxPrimitive.Trigger
			ref={trigger}
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
	side: sideProp,
	sideOffset = 4,
	align = "start",
	alignOffset = 0,
	searchPlaceholder = "Search…",
	onSearchTab,
	...props
}: ComboboxPrimitive.Popup.Props &
	Pick<
		ComboboxPrimitive.Positioner.Props,
		"align" | "alignOffset" | "side" | "sideOffset"
	> & {
		/** `false` for a list short enough to need no search box. */
		searchPlaceholder?: string | false;
		/** Tab (not Shift+Tab) pressed in the search box, before focus moves on
		 *  and the popup closes — where a picker takes its one remaining match. */
		onSearchTab?: () => void;
	}) {
	const { side } = useContext(PopupSideContext);
	return (
		<ComboboxPrimitive.Portal container={popupLayer()}>
			<ComboboxPrimitive.Positioner
				side={sideProp ?? side}
				sideOffset={sideOffset}
				align={align}
				alignOffset={alignOffset}
				// The side was chosen above with the room measured; see the note on
				// `Combobox`. Alignment still shifts to stay inside the viewport.
				collisionAvoidance={{ side: "none", align: "shift" }}
				className="isolate z-50 outline-none"
			>
				<ComboboxPrimitive.Popup
					data-slot="combobox-content"
					className={cn(
						"popup-scaled relative isolate z-50 flex max-h-(--popup-available-height) w-(--popup-anchor-width) min-w-56 origin-(--transform-origin) flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-[var(--shadow-pop)] outline-none duration-(--dur-fast) ease-(--ease-out) data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
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
								onKeyDown={(event) => {
									if (event.key === "Tab" && !event.shiftKey) onSearchTab?.();
								}}
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
