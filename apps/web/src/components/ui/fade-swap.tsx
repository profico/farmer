import { AnimatePresence, motion } from "motion/react";

/** Travel distance (px) the panel lifts through as it swaps. */
const FADE_OFFSET = 4;

/**
 * Crisp, no overshoot — deliberately shorter than the `lib/motion.ts` springs
 * because this is a full-panel swap the user is waiting to read, not a surface
 * appearing over the page. The curve matches the springs' decelerating
 * character (fast out, gentle settle).
 */
const FADE_TRANSITION = { duration: 0.13, ease: [0.32, 0.72, 0, 1] } as const;

/**
 * Crossfades its content whenever `activeKey` changes — the shared "body"
 * transition used when switching between tabs/filters (Reports, Time off, the
 * Time day/week/month views): the outgoing panel lifts and fades, the incoming
 * one rises into place.
 *
 * Under `prefers-reduced-motion` the root `<MotionConfig reducedMotion="user">`
 * drops the y-translation and leaves the opacity crossfade — no branching here.
 */
function FadeSwap({
	activeKey,
	className,
	children,
}: {
	activeKey: string;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<AnimatePresence mode="wait" initial={false}>
			<motion.div
				key={activeKey}
				className={className}
				initial={{ opacity: 0, y: FADE_OFFSET }}
				animate={{ opacity: 1, y: 0 }}
				exit={{ opacity: 0, y: -FADE_OFFSET }}
				transition={FADE_TRANSITION}
			>
				{children}
			</motion.div>
		</AnimatePresence>
	);
}

export { FadeSwap };
