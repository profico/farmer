import type { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import * as React from "react";

/**
 * Whether a `Dialog` or an `AlertDialog` shows as a centered modal or as a
 * bottom sheet.
 *
 * On a phone a modal is the wrong shape: it floats in the middle of a small
 * screen, far from the thumb, and the iOS scroll lock does not hold under it.
 * So below the `md` breakpoint both components render Base UI's drawer, and
 * each call site keeps the same API. The breakpoint is the one the mobile tab
 * bar uses (`md:hidden`), so a screen that shows the tab bar shows sheets.
 *
 * A phone in landscape is often wider than `md` (844px is common), but it is
 * still a phone. The second condition catches it: a touch screen that is short.
 * A tablet has more than 500px of height in both orientations, so it keeps the
 * modal.
 */
export type ModalMode = "dialog" | "drawer";

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
 * The details a responsive root gives to `onOpenChange`. The drawer's type is
 * the wider one: it adds the `swipe` and `closeWatcher` reasons to the reasons
 * of a dialog. A call site that reads only `open` does not see a difference.
 */
export type ModalChangeEventDetails = DrawerPrimitive.Root.ChangeEventDetails;

/**
 * The mode of the nearest open `Dialog` or `AlertDialog`. A footer reads it to
 * pick its layout, and a nested root reads it to take the same mode as its
 * parent. A confirmation that opens from a sheet is then a sheet too, also when
 * the window changed size after the parent opened.
 */
export const ModalModeContext = React.createContext<ModalMode | null>(null);

export function useModalModeContext(): ModalMode {
	return React.useContext(ModalModeContext) ?? "dialog";
}

/**
 * The mode for one root, locked from the moment it opens until its exit
 * animation ends.
 *
 * The lock is necessary because the two modes are two different Base UI roots.
 * A change from one root to the other unmounts the whole subtree, and a person
 * loses what they typed in the form. So a phone that turns to landscape while a
 * sheet is open keeps the sheet. The mode is read from `matchMedia` in the same
 * render that opens the root, not from an effect, so the first frame already
 * has the correct mode.
 *
 * While the root is closed, the mode follows the media query. Call `release`
 * from `onOpenChangeComplete(false)`, after the exit animation, to end the
 * lock. A release that comes late, after the root opened again, does nothing.
 */
export function useModalMode(open: boolean) {
	const parent = React.useContext(ModalModeContext);
	const live = React.useSyncExternalStore(subscribe, readMode, readServerMode);
	const [held, setHeld] = React.useState<ModalMode | null>(() =>
		open ? (parent ?? readMode()) : null,
	);
	const [wasOpen, setWasOpen] = React.useState(open);

	// The "previous value in state" pattern: React discards this render and
	// renders again at once with the new state, before anything commits.
	let mode = held;
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			mode = parent ?? readMode();
			setHeld(mode);
		}
	}

	const openRef = React.useRef(open);
	React.useLayoutEffect(() => {
		openRef.current = open;
	}, [open]);
	const release = React.useCallback(() => {
		if (!openRef.current) setHeld(null);
	}, []);

	return { mode: mode ?? parent ?? live, release };
}

/*
 * The layout of a Dialog or an AlertDialog as a sheet. The sheet itself is
 * `DrawerContent` (drawer.tsx), so the look of a drawer has one definition.
 * These classes keep the split of the dialog: the popup never scrolls, the body
 * inside it scrolls, and the footer sticks to the bottom of the body.
 */

/**
 * The cap of a sheet, as a percentage of the drawer viewport and not in `dvh`.
 * The viewport gets the height of the software keyboard as bottom padding
 * (drawer.tsx), and a percentage height resolves against the content box, so
 * the cap shrinks when the keyboard opens and the footer stays above it. On
 * iOS `dvh` does not change for the keyboard. The gap at the top keeps a strip
 * of the page in view, so the sheet reads as a sheet and not as a new page.
 *
 * A phone in landscape is wider than `sm`. There the sheet takes the width of
 * the dialog, so each content component adds its `sm:max-w-*` after this, and
 * the `sm:max-w-*` class of a call site still has the last word.
 */
export const sheetPopupClassName =
	"max-h-[calc(100%-var(--safe-t)-2rem)] gap-0 sm:border-x";

/**
 * The body of a sheet. It keeps the `p-6` of the dialog body, so the bleed of
 * the footer (`-mx-6`) is the same in both modes. The bottom padding adds the
 * safe-area inset, so the end of a body without a footer clears the home
 * indicator. The body is the scrollport, and a scrollport clips to its own
 * radius, so `rounded-t-2xl` (the radius of the sheet) keeps scrolled content
 * inside the rounded corners.
 */
export const sheetBodyClassName =
	"grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto overscroll-contain rounded-t-2xl p-6 pb-[calc(1.5rem+var(--safe-b))]";

/**
 * The footer of a sheet sits on the bottom edge of the screen. It has no
 * rounded corners, and its bottom padding clears the home indicator. The bleed
 * and the sticky inset grow by the safe-area inset, because the sheet body adds
 * that inset below its `p-6`.
 *
 * The buttons stay stacked at full width, also above `sm`, because a phone in
 * landscape is still a phone. The primary action is the last child, so
 * `flex-col-reverse` puts it on top and Cancel on the bottom edge. An empty
 * spacer child (a call site uses one for `sm:justify-between`) would add one
 * more gap to the stack, so it is hidden.
 */
export const sheetFooterClassName =
	"sticky -bottom-[calc(1.5rem+var(--safe-b))] z-10 -mx-6 mt-1 -mb-[calc(1.5rem+var(--safe-b))] flex shrink-0 flex-col-reverse gap-2 border-t border-line2 bg-popover px-6 pt-4 pb-[calc(1rem+var(--safe-b))] *:empty:hidden";
