import { AnimatePresence, motion } from "motion/react";
import { useAnimationProfile } from "#/hooks/use-animation-profile.ts";

/**
 * Crossfades its content whenever `activeKey` changes — the shared "body"
 * transition used when switching between tabs/filters (Reports, Time off, the
 * Time day/week/month views). Travel distance and timing come from the user's
 * animation-speed preference (lib/animation.ts): the outgoing panel lifts and
 * fades, the incoming one rises into place — or, at "instant"/reduced-motion,
 * swaps with no movement.
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
	const { fadeOffset, fadeTransition } = useAnimationProfile();
	return (
		<AnimatePresence mode="wait" initial={false}>
			<motion.div
				key={activeKey}
				className={className}
				initial={{ opacity: 0, y: fadeOffset }}
				animate={{ opacity: 1, y: 0 }}
				exit={{ opacity: 0, y: -fadeOffset }}
				transition={fadeTransition}
			>
				{children}
			</motion.div>
		</AnimatePresence>
	);
}

export { FadeSwap };
