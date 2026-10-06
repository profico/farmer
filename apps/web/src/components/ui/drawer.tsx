"use client";

import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { XIcon } from "@phosphor-icons/react";
import type * as React from "react";

import { Button } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";

// A bottom sheet that follows the finger. Not the Sheet with side="bottom":
// Base UI's dialog scroll lock is `overflow: hidden` on <html>, which iOS
// ignores for touch, so the page kept scrolling under the backdrop. The
// drawer's Viewport cancels those touchmoves itself (still letting a scrollable
// list inside the popup scroll) and adds swipe-to-dismiss.
//
// Animated with CSS transitions rather than motion, unlike every other popup:
// the swipe writes `--drawer-swipe-movement-y` on every pointer move, and a
// motion-owned `transform` would overwrite it. The curve has no overshoot, so
// the release from a drag never bounces past where the finger let go.

function Drawer(props: DrawerPrimitive.Root.Props) {
	return <DrawerPrimitive.Root {...props} />;
}

function DrawerTrigger(props: DrawerPrimitive.Trigger.Props) {
	return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerClose(props: DrawerPrimitive.Close.Props) {
	return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerContent({
	className,
	children,
	showCloseButton = true,
	...props
}: DrawerPrimitive.Popup.Props & { showCloseButton?: boolean }) {
	return (
		// The provider keeps the focused field in view, and it writes the
		// keyboard height that lifts the sheet above the keyboard. Every sheet
		// has it, so a text field in any sheet stays above the keyboard.
		<DrawerPrimitive.VirtualKeyboardProvider>
			<DrawerPrimitive.Portal>
				<DrawerPrimitive.Backdrop
					data-slot="drawer-overlay"
					// Fades with the drag, so pulling the sheet halfway down shows the page
					// halfway back. `absolute` on iOS covers the area behind a collapsed
					// toolbar, which `fixed` leaves uncovered.
					className="fixed inset-0 z-50 min-h-[calc(100*var(--dvh))] bg-black/25 opacity-[calc(1-var(--drawer-swipe-progress))] transition-opacity duration-300 ease-(--ease-drawer) supports-backdrop-filter:backdrop-blur-xs supports-[-webkit-touch-callout:none]:absolute data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*300ms)] data-starting-style:opacity-0 data-swiping:duration-0"
				/>
				<DrawerPrimitive.Viewport
					data-slot="drawer-viewport"
					// The bottom padding lifts the sheet above the software keyboard.
					// `Drawer.VirtualKeyboardProvider` sets `--drawer-keyboard-inset` only
					// while a field has focus, so the `0px` fallback is necessary. The
					// inset is in viewport pixels and this element is inside the
					// `--ui-scale` zoom, so the inset is divided by the scale.
					className="fixed inset-0 z-50 flex items-end justify-center pb-[calc(var(--drawer-keyboard-inset,0px)/var(--ui-scale,1))]"
				>
					<DrawerPrimitive.Popup
						data-slot="drawer-content"
						className={cn(
							// The `after:` strip is the bleed: it hangs below the popup in its
							// color, so an upward over-drag never shows the page underneath.
							//
							// The `before:` layer dims the sheet behind a nested drawer,
							// because Base UI renders a backdrop only for the outermost drawer.
							// The sheet behind also shrinks a little, so the two read as a stack.
							"relative flex w-full origin-top flex-col gap-4 rounded-t-2xl border-t bg-popover bg-clip-padding text-base text-popover-foreground shadow-[var(--lift)] outline-none before:pointer-events-none before:absolute before:inset-0 before:z-20 before:rounded-[inherit] before:bg-black/0 before:transition-colors before:duration-300 after:absolute after:inset-x-0 after:top-full after:h-12 after:bg-popover [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-300 ease-(--ease-drawer) data-ending-style:[transform:translateY(calc(100%+2px))] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*300ms)] data-starting-style:[transform:translateY(calc(100%+2px))] data-nested-drawer-open:[transform:translateY(calc(var(--drawer-swipe-movement-y)-0.5rem))_scale(0.95)] data-nested-drawer-open:before:bg-black/25 data-nested-drawer-swiping:duration-0 data-swiping:select-none motion-reduce:transition-none motion-reduce:data-ending-style:[transform:none] motion-reduce:data-starting-style:[transform:none] motion-reduce:data-nested-drawer-open:[transform:none]",
							className,
						)}
						{...props}
					>
						<div
							aria-hidden
							className="absolute top-2 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full bg-line"
						/>
						{children}
						{showCloseButton && (
							<DrawerPrimitive.Close
								data-slot="drawer-close"
								render={
									<Button
										variant="ghost"
										className="absolute top-3 right-3"
										size="icon-sm"
									/>
								}
							>
								<XIcon weight="regular" />
								<span className="sr-only">Close</span>
							</DrawerPrimitive.Close>
						)}
					</DrawerPrimitive.Popup>
				</DrawerPrimitive.Viewport>
			</DrawerPrimitive.Portal>
		</DrawerPrimitive.VirtualKeyboardProvider>
	);
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="drawer-header"
			className={cn("flex flex-col gap-0.5 p-4", className)}
			{...props}
		/>
	);
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
	return (
		<DrawerPrimitive.Title
			data-slot="drawer-title"
			className={cn("h2", className)}
			{...props}
		/>
	);
}

function DrawerDescription({
	className,
	...props
}: DrawerPrimitive.Description.Props) {
	return (
		<DrawerPrimitive.Description
			data-slot="drawer-description"
			className={cn("text-sm leading-normal text-muted-foreground", className)}
			{...props}
		/>
	);
}

export {
	Drawer,
	DrawerTrigger,
	DrawerClose,
	DrawerContent,
	DrawerHeader,
	DrawerTitle,
	DrawerDescription,
};
