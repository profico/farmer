import { useReducedMotion } from "motion/react";
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
 * Speed is tuned so opening a dialog/menu/sheet feels as snappy as navigating
 * between pages — the spring adds interruptibility and a touch of physicality
 * on top of that tempo, it doesn't make things slower.
 *
 * Bounce is deliberately restrained: only surfaces that feel physical
 * (dialog popup, the sliding tab-bar pill, drawers) get any overshoot;
 * functional chrome (backdrops, menus) stays crisp at `bounce: 0`.
 */

/**
 * The CSS easing tokens, for the tweens that cannot reach them.
 *
 * `--ease-out` and `--ease-in-out` live in `styles.css` and are the house
 * curves. A JS tween cannot read a custom property, so every one of them was
 * re-typing the control points — seven copies of `--ease-out` across the
 * assistant and Rewind, which is how a token system quietly stops being one.
 * Import these instead, and change the curve in two places rather than nine.
 */
export const easeOut = [0.23, 1, 0.32, 1] as const;
export const easeInOut = [0.77, 0, 0.175, 1] as const;

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

/**
 * The transition for anything that opens or closes by changing its HEIGHT.
 *
 * `<MotionConfig reducedMotion="user">` drops transform, scale and slide — and
 * nothing else. A banner that expands from `height: 0` to `height: "auto"` is
 * therefore untouched by it, and it is the most disruptive movement of the lot,
 * because every row under it travels too. Several call sites carried a comment
 * saying reduced motion was "handled globally by the root MotionConfig", which
 * was true of their opacity and false of their height.
 *
 * So the height is ended by hand and the fade is kept: the panel still arrives
 * and departs, it just stops pushing the page around on the way.
 *
 * The per-property form matters. A bare `{ duration: 0 }` applies to EVERY
 * animated property on the component, and every call site here animates opacity
 * beside height — so it took the fade out too and the banners popped, which is
 * the opposite of what the paragraph above promises.
 */
export function useHeightTransition(): Transition {
	const reduced = useReducedMotion();
	if (!reduced) return springProductive;
	return {
		duration: 0.15,
		height: { duration: 0 },
		paddingTop: { duration: 0 },
		paddingBottom: { duration: 0 },
		marginTop: { duration: 0 },
		marginBottom: { duration: 0 },
	};
}

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
export const sheetVariants = {
	top: { open: { y: 0, opacity: 1 }, closed: { y: "-100%", opacity: 0.999 } },
	bottom: { open: { y: 0, opacity: 1 }, closed: { y: "100%", opacity: 0.999 } },
	left: { open: { x: 0, opacity: 1 }, closed: { x: "-100%", opacity: 0.999 } },
	right: { open: { x: 0, opacity: 1 }, closed: { x: "100%", opacity: 0.999 } },
} satisfies Record<SheetSide, Variants>;

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
