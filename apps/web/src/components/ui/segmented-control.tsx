import { motion } from "motion/react";
import {
	cloneElement,
	createContext,
	type ReactElement,
	useContext,
	useId,
} from "react";

import { springLayout } from "#/lib/motion.ts";
import { cn } from "#/lib/utils.ts";

const SegmentedControlContext = createContext<{ layoutId: string }>({
	layoutId: "",
});

/**
 * A segmented control whose active-segment highlight slides fluidly between
 * segments via a shared-layout spring — the single source of truth for the
 * app's tab styling (Time day/week/month, Reports utilization/budgets, …).
 *
 * Segments are `<SegmentedControlItem>`. Each item can render as a plain
 * button (state-driven) or wrap any element via `render` (e.g. a router
 * `<Link>`), so the same look works for both client-state tabs and navigation.
 */
function SegmentedControl({
	className,
	...props
}: React.ComponentProps<"div">) {
	// Unique per instance so multiple controls on one page never share (and
	// fight over) the same layout animation.
	const layoutId = useId();
	return (
		<SegmentedControlContext.Provider value={{ layoutId }}>
			<div
				data-slot="segmented-control"
				className={cn(
					// The track is the sidebar's recessed ground and the pill is the page's own
					// paper laid on it — the same two surfaces the nav uses to say "this one".
					"inline-flex w-fit items-center gap-0.5 rounded-lg border border-border bg-secondary p-[3px] text-muted-foreground",
					className,
				)}
				{...props}
			/>
		</SegmentedControlContext.Provider>
	);
}

type SegmentedControlItemProps = React.ComponentProps<"button"> & {
	active?: boolean;
	/** Render as a different element (e.g. a router `<Link>`) — Base UI idiom. */
	render?: ReactElement<{ className?: string; children?: React.ReactNode }>;
};

function SegmentedControlItem({
	active,
	className,
	render,
	children,
	...props
}: SegmentedControlItemProps) {
	const { layoutId } = useContext(SegmentedControlContext);

	const inner = (
		<>
			{active && (
				<motion.span
					aria-hidden
					layoutId={layoutId}
					// Shared-element move; `reducedMotion="user"` on the root
					// <MotionConfig> makes the pill jump instead of glide.
					transition={springLayout}
					className="absolute inset-0 z-0 rounded-md bg-background shadow-[0_1px_2px_color-mix(in_srgb,var(--fg)_6%,transparent)]"
				/>
			)}
			<span className="relative z-10 inline-flex items-center gap-1.5">
				{children}
			</span>
		</>
	);

	const cls = cn(
		"relative inline-flex items-center justify-center rounded-md px-3.5 py-1 text-sm whitespace-nowrap outline-none transition-colors duration-(--dur-base) focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
		active
			? "font-medium text-foreground"
			: "text-muted-foreground hover:text-foreground",
		className,
	);

	if (render) {
		return cloneElement(render, {
			className: cn(cls, render.props.className),
			children: inner,
		});
	}

	return (
		<button
			type="button"
			data-active={active ? "" : undefined}
			className={cls}
			{...props}
		>
			{inner}
		</button>
	);
}

export { SegmentedControl, SegmentedControlItem };
