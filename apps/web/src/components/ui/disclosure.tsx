import { CaretRightIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { springProductive } from "#/lib/motion.ts";
import { cn } from "#/lib/utils.ts";

/**
 * Anything that unrolls in place — the sidebar's Settings group, a teammate's
 * entries on a project page, "More options" in a dialog — and the one way it
 * does so (DESIGN.md, "Disclosures"): a height spring on open, faster on
 * close, with the chevron beside the control rotating a quarter turn.
 *
 * `overflow-hidden` only while the height is animating: a focus ring on a
 * child sits outside its border, and a clipped box exactly the list's size
 * would cut it off once the list is open.
 */
export function Disclosure({
	open,
	children,
	className,
}: {
	open: boolean;
	children: ReactNode;
	className?: string;
}) {
	const reduced = useReducedMotion();
	return (
		<AnimatePresence initial={false}>
			{open && (
				<motion.div
					key="disclosure"
					initial={reduced ? false : { height: 0, opacity: 0 }}
					animate={{
						height: "auto",
						opacity: 1,
						transitionEnd: { overflow: "visible" },
					}}
					exit={
						reduced
							? { opacity: 0, transition: { duration: 0 } }
							: {
									height: 0,
									opacity: 0,
									overflow: "hidden",
									transition: { duration: 0.18, ease: [0.23, 1, 0.32, 1] },
								}
					}
					transition={springProductive}
					style={{ overflow: "hidden" }}
					className={className}
				>
					{children}
				</motion.div>
			)}
		</AnimatePresence>
	);
}

/** The chevron beside a disclosure's control. Pointing right closed, down open. */
export function DisclosureChevron({
	open,
	className,
}: {
	open: boolean;
	className?: string;
}) {
	return (
		<CaretRightIcon
			weight="bold"
			aria-hidden
			className={cn(
				"size-3 shrink-0 text-muted-foreground transition-transform duration-(--dur-slow) ease-(--ease-out)",
				open && "rotate-90",
				className,
			)}
		/>
	);
}
