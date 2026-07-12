import type { Transition, Variants } from "motion/react";
import * as React from "react";

/**
 * Motion system foundation.
 *
 * Spring presets are mapped from Apple's damping/response design values
 * (see WWDC "Designing Fluid Interfaces") onto motion's designer-friendly
 * `{ bounce, visualDuration }` API:
 *   - `bounce: 0`   → critically damped, no overshoot (damping 1.0)
 *   - `bounce > 0`  → slight overshoot, reserved for momentum/physical motion
 *   - `visualDuration` → time to visually reach the target (≈ Apple "response"),
 *     NOT total settle time.
 *
 * Speed is tuned to the page-transition scale (`--motion-duration-fast`, 0.12s
 * in styles.css) so opening a dialog/menu/sheet feels as snappy as navigating
 * between pages — the spring adds interruptibility and a touch of physicality
 * on top of that same tempo, it doesn't make things slower.
 *
 * Bounce is deliberately restrained: only surfaces that feel physical
 * (dialog popup, the sliding tab-bar pill, drawers) get any overshoot;
 * functional chrome (backdrops, menus) stays crisp at `bounce: 0`.
 */

/** Crisp, no overshoot — backdrops, menus, small state changes. */
export const springProductive: Transition = {
	type: "spring",
	bounce: 0,
	visualDuration: 0.13,
};

/** Slight overshoot for physical moments — dialog popup, tab-bar pill. */
export const springExpressive: Transition = {
	type: "spring",
	bounce: 0.15,
	visualDuration: 0.16,
};

/** Gentle overshoot on a slightly longer travel — drawers / sheets. */
export const springSheet: Transition = {
	type: "spring",
	bounce: 0.12,
	visualDuration: 0.18,
};

/** Shared-element / layout moves (kept distinct so it can be retuned alone). */
export const springLayout: Transition = {
	type: "spring",
	bounce: 0.15,
	visualDuration: 0.16,
};

export const backdropVariants: Variants = {
	open: { opacity: 1 },
	closed: { opacity: 0 },
};

/**
 * Dialog popup. Centering (`x/y: -50%`) is held constant across states and
 * lives here rather than in a Tailwind `-translate-*` class: motion writes the
 * full `transform`, so any translate utility would be overwritten and the
 * dialog would jump to the top-left of its centered anchor.
 */
export const dialogPopupVariants: Variants = {
	open: { opacity: 1, scale: 1, x: "-50%", y: "-50%" },
	closed: { opacity: 0, scale: 0.96, x: "-50%", y: "-50%" },
};

/**
 * Menu popup. Scale grows from `--transform-origin` (set by Base UI on the same
 * node via the `origin-(--transform-origin)` class) so the menu emerges from its
 * trigger — Apple spatial anchoring. motion never touches `transform-origin`.
 */
export const menuPopupVariants: Variants = {
	open: { opacity: 1, scale: 1 },
	closed: { opacity: 0, scale: 0.96 },
};

export type SheetSide = "top" | "right" | "bottom" | "left";

/**
 * Sheets slide in from — and back out to — the same edge (Apple spatial
 * consistency). `closed.opacity: 0.999` is intentional: it keeps an `opacity`
 * animation in every exit so Base UI's `element.getAnimations()` unmount
 * detection stays reliable even though the visual change is a pure slide.
 */
export const sheetVariants: Record<SheetSide, Variants> = {
	top: { open: { y: 0, opacity: 1 }, closed: { y: "-100%", opacity: 0.999 } },
	bottom: { open: { y: 0, opacity: 1 }, closed: { y: "100%", opacity: 0.999 } },
	left: { open: { x: 0, opacity: 1 }, closed: { x: "-100%", opacity: 0.999 } },
	right: { open: { x: 0, opacity: 1 }, closed: { x: "100%", opacity: 0.999 } },
};

/** `{ open, actionsRef }` shared from a Base-UI popup wrapper to its content. */
export type PopupPresence<Actions> = {
	open: boolean;
	actionsRef: React.RefObject<Actions | null>;
};

/**
 * Controllable open-state (Base UI ships no such helper). Supports controlled
 * (`open`/`onOpenChange`), uncontrolled (`defaultOpen` + a Trigger), and both at
 * once. The wrapper always forwards the resolved value + this setter to Base
 * UI's Root, so a Trigger press flows through `onOpenChange` → internal state →
 * `open`, keeping AnimatePresence and Base UI driven by one source of truth.
 */
export function useControllableOpen<Details>(params: {
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean, details: Details) => void;
}): readonly [boolean, (open: boolean, details: Details) => void] {
	const { open, defaultOpen, onOpenChange } = params;
	const [uncontrolled, setUncontrolled] = React.useState(defaultOpen ?? false);
	const isControlled = open !== undefined;
	const value = open ?? uncontrolled;
	const setOpen = React.useCallback(
		(next: boolean, details: Details) => {
			if (!isControlled) setUncontrolled(next);
			onOpenChange?.(next, details);
		},
		[isControlled, onOpenChange],
	);
	return [value, setOpen] as const;
}
