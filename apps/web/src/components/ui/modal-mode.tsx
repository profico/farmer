import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import * as React from "react";

import { DrawerContent } from "#/components/ui/drawer.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * Whether a `Dialog` or an `AlertDialog` shows as a centered modal or as a
 * bottom sheet. Below `md` (the breakpoint of the mobile tab bar) both render
 * Base UI's drawer, because a centered modal is far from the thumb and the
 * iOS scroll lock does not hold under it.
 *
 * A phone in landscape is often wider than `md`, so the query also matches a
 * touch screen that is short. A tablet is taller than 500px in both
 * orientations, so it keeps the modal.
 */
type ModalMode = "dialog" | "drawer";

const DRAWER_QUERY =
	"(max-width: 767px), (pointer: coarse) and (max-height: 500px)";

function subscribe(onChange: () => void) {
	const mql = window.matchMedia(DRAWER_QUERY);
	mql.addEventListener("change", onChange);
	return () => mql.removeEventListener("change", onChange);
}

function readMode(): ModalMode {
	if (import.meta.env.SSR) return "dialog";
	return window.matchMedia(DRAWER_QUERY).matches ? "drawer" : "dialog";
}

function readServerMode(): ModalMode {
	return "dialog";
}

/**
 * The drawer's details type is the wider one: it adds the `swipe` and
 * `closeWatcher` reasons to those of a dialog.
 */
export type ModalChangeEventDetails = DrawerPrimitive.Root.ChangeEventDetails;

/**
 * The mode of the nearest open root. A nested root takes the mode of its
 * parent, so a confirmation that opens from a sheet is a sheet too.
 */
export const ModalModeContext = React.createContext<ModalMode | null>(null);

export function useModalModeContext(): ModalMode {
	return React.useContext(ModalModeContext) ?? "dialog";
}

/**
 * The mode a root takes when it opens. A nested root takes the mode of its
 * parent. A root with no parent takes the mode that the media query gives.
 */
export function modeOnOpen(
	parent: ModalMode | null,
	current: ModalMode,
): ModalMode {
	return parent ?? current;
}

/**
 * The mode for one root. The root decides the mode when it opens, and it holds
 * that mode until it opens again. The two modes are two different Base UI
 * roots, so a change of mode would unmount everything below the root. A
 * change while open would lose what the person typed. A change while closed
 * would lose the state that a closed dialog keeps, such as the body of
 * `AddBlockDialog`. A root that never opened follows the media query, so the
 * first render on a phone is a dialog and then a drawer, as the hydration
 * needs.
 */
export function useModalMode(open: boolean) {
	const parent = React.useContext(ModalModeContext);
	const live = React.useSyncExternalStore(subscribe, readMode, readServerMode);
	const [held, setHeld] = React.useState<ModalMode | null>(() =>
		open ? modeOnOpen(parent, readMode()) : null,
	);
	const [wasOpen, setWasOpen] = React.useState(open);

	// The "previous value in state" pattern: React discards this render and
	// renders again at once with the new state, before anything commits.
	let mode = held;
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			mode = modeOnOpen(parent, readMode());
			setHeld(mode);
		}
	}

	return mode ?? parent ?? live;
}

/**
 * A Dialog or an AlertDialog as a sheet. The popup never scrolls, the body
 * scrolls, and the footer sticks to the bottom of the body.
 *
 * The cap is a percentage of the drawer viewport, not `dvh`. The viewport
 * gets the keyboard height as bottom padding (drawer.tsx), so the cap shrinks
 * when the keyboard opens. On iOS `dvh` does not change for the keyboard.
 *
 * The body is the scrollport, so `rounded-t-2xl` keeps scrolled content
 * inside the corners of the sheet.
 */
export function ModalSheetContent({
	kind,
	className,
	children,
	...props
}: Omit<React.ComponentProps<typeof DrawerContent>, "className"> & {
	kind: "dialog" | "alert-dialog";
	className?: string;
}) {
	return (
		<DrawerContent
			data-slot={`${kind}-content`}
			className={cn(
				"max-h-[calc(100%-var(--safe-t)-2rem)] gap-0 sm:border-x",
				className,
			)}
			{...props}
		>
			<div
				data-slot={`${kind}-body`}
				className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto overscroll-contain rounded-t-2xl p-6 pb-[calc(1.5rem+var(--safe-b))]"
			>
				{children}
			</div>
		</DrawerContent>
	);
}

/**
 * The bleed and the sticky inset include the safe-area inset, because the
 * sheet body adds it below its `p-6`. The buttons stay stacked above `sm`,
 * because a phone in landscape is still a phone. An empty spacer child would
 * add a gap to the stack, so it is hidden.
 */
export const sheetFooterClassName =
	"sticky -bottom-[calc(1.5rem+var(--safe-b))] z-10 -mx-6 mt-1 -mb-[calc(1.5rem+var(--safe-b))] flex shrink-0 flex-col-reverse gap-2 border-t border-line2 bg-popover px-6 pt-4 pb-[calc(1rem+var(--safe-b))] *:empty:hidden";
