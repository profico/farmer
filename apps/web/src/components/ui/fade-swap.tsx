import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";

import { easeOut } from "#/lib/motion.ts";

/** Travel distance (px) the panel moves through as it swaps. */
const FADE_OFFSET = 4;

/**
 * Crisp, no overshoot — deliberately shorter than the `lib/motion.ts` springs
 * because this is a full-panel swap the user is waiting to read, not a surface
 * appearing over the page. The curve is `--ease-out`, the house entrance curve,
 * which matches the springs' decelerating character (fast out, gentle settle).
 * It used to be a hand-typed `[0.32, 0.72, 0, 1]` — the iOS drawer curve, which
 * is a different shape and exists nowhere in `lib/motion.ts`.
 */
const FADE_TRANSITION = { duration: 0.13, ease: easeOut } as const;

/**
 * Which way the content travels as it swaps.
 *
 * The default `up` suits a body swapped by something ABOVE it — a tab row, a
 * filter — where the panel has no direction of its own to honour. Give a
 * horizontal one when the control that changed it moves horizontally, so the
 * content leaves the way the control went: pressing the RIGHT segment sends the
 * content `left`, the same relationship a paged view has (Apple spatial
 * consistency — a thing exits along the path it was pushed).
 */
type FadeDirection = "up" | "left" | "right";

const TRAVEL = {
	up: { enter: { y: FADE_OFFSET }, exit: { y: -FADE_OFFSET } },
	left: { enter: { x: FADE_OFFSET }, exit: { x: -FADE_OFFSET } },
	right: { enter: { x: -FADE_OFFSET }, exit: { x: FADE_OFFSET } },
} satisfies Record<FadeDirection, { enter: object; exit: object }>;

/**
 * Crossfades its content whenever `activeKey` changes — the shared "body"
 * transition used when switching between tabs/filters (Reports, Time off, the
 * Time day/week/month views, the sidebar's Browse/Chat lists): the outgoing
 * panel drifts and fades, the incoming one arrives into place.
 *
 * Under `prefers-reduced-motion` the root `<MotionConfig reducedMotion="user">`
 * drops the translation and leaves the opacity crossfade — no branching here.
 */
function FadeSwap({
	activeKey,
	className,
	direction = "up",
	order,
	children,
}: {
	activeKey: string;
	className?: string;
	/** Which way the content travels. See `FadeDirection`. */
	direction?: FadeDirection;
	/**
	 * The keys in the order their control draws them, for a strip you can move
	 * along in either direction.
	 *
	 * A fixed `direction` cannot express a tab row: pressing the segment to the
	 * right and pressing the one to the left are opposite movements, and one
	 * value is right for one of them and backwards for the other. Given this,
	 * the travel is derived per swap from where the reader was — which is what
	 * the rule above actually asks for. `direction` is ignored when it is
	 * present.
	 */
	order?: readonly string[];
	children: React.ReactNode;
}) {
	// Read during render and written after it, so on the render that commits a
	// swap this still holds the key the reader was on.
	const previous = useRef<string | null>(null);
	useEffect(() => {
		previous.current = activeKey;
	}, [activeKey]);

	let resolved = direction;
	if (order) {
		const from =
			previous.current === null ? -1 : order.indexOf(previous.current);
		const to = order.indexOf(activeKey);
		// Pressing the segment to the RIGHT sends the content left, the same
		// relationship a paged view has. A first paint does not animate at all
		// (`initial={false}` below), so its arbitrary answer is never seen.
		resolved = from !== -1 && to !== -1 && to < from ? "right" : "left";
	}
	const travel = TRAVEL[resolved];
	return (
		<AnimatePresence mode="wait" initial={false}>
			<motion.div
				key={activeKey}
				className={className}
				initial={{ opacity: 0, ...travel.enter }}
				animate={{ opacity: 1, x: 0, y: 0 }}
				exit={{ opacity: 0, ...travel.exit }}
				transition={FADE_TRANSITION}
			>
				{children}
			</motion.div>
		</AnimatePresence>
	);
}

export { FadeSwap };
