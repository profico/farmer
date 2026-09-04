import { AnimatePresence, motion } from "motion/react";

/** Travel distance (px) the panel moves through as it swaps. */
const FADE_OFFSET = 4;

/**
 * Crisp, no overshoot — deliberately shorter than the `lib/motion.ts` springs
 * because this is a full-panel swap the user is waiting to read, not a surface
 * appearing over the page. The curve matches the springs' decelerating
 * character (fast out, gentle settle).
 */
const FADE_TRANSITION = { duration: 0.13, ease: [0.32, 0.72, 0, 1] } as const;

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
	children,
}: {
	activeKey: string;
	className?: string;
	/** Which way the content travels. See `FadeDirection`. */
	direction?: FadeDirection;
	children: React.ReactNode;
}) {
	const travel = TRAVEL[direction];
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
