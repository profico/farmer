import { useCallback, useLayoutEffect, useRef } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * A scroll region that fades at whichever edge has more content behind it.
 *
 * The fade is a mask on the SCROLLER, not a gradient overlay stacked on top of
 * it. An overlay has to be painted in the island's color, which means it stops
 * working the moment the thing underneath isn't that color (a table's banded
 * row, the calendar's tinted blocks) and it sits above the content, so it eats
 * pointer events at exactly the edge people flick from. A mask fades whatever
 * is actually there, in any theme, and is inert.
 *
 * Measured in JS rather than driven by `animation-timeline: scroll()`, which
 * expresses this in three lines of CSS and is still Chromium-only — this runs on
 * a scroll listener and a ResizeObserver, which every browser has.
 *
 * The two edges are separate custom properties rather than one "is it
 * scrollable" flag, because the top and bottom answer different questions and
 * are wrong at different moments: at rest at the top there is nothing above to
 * hint at, and a short page has neither.
 *
 * Keeps `--fade-top` / `--fade-bottom` on `ref` in step with its scroll
 * position. Pair it with the `scroll-fade` class, which is what turns those two
 * lengths into the mask.
 *
 * Split out from the component below because the sidebar's scroll region is
 * already a component with its own element (`SidebarContent`) — it needs the
 * behaviour without a wrapper div, and a second copy of this arithmetic is a
 * second thing to keep in step.
 */
export function useScrollFade(
	ref: React.RefObject<HTMLElement | null>,
	{ gutter = false }: { gutter?: boolean } = {},
) {
	const measure = useCallback(() => {
		const element = ref.current;
		if (!element) return;
		const { scrollTop, scrollHeight, clientHeight } = element;
		// A pixel of slack at each end: sub-pixel layout and momentum scrolling
		// both leave scrollTop a fraction off zero, which would otherwise hold a
		// fade open against a region that is already at its end.
		const top = scrollTop > 1;
		const bottom = scrollTop + clientHeight < scrollHeight - 1;
		element.style.setProperty("--fade-top", top ? "var(--fade-size)" : "0px");
		element.style.setProperty(
			"--fade-bottom",
			bottom ? "var(--fade-size)" : "0px",
		);
	}, [ref]);

	// The bar's width while it shows, 0 while it does not — `.page-scroll` takes
	// it back out of its right padding. Kept off the scroll path: the bar can
	// only come or go when a size or a child changes, so this runs on mount and
	// from the two observers, never on a scroll.
	//
	// Both widths are whole pixels, so a fractional bar (Firefox at a page zoom)
	// is compensated to within a pixel rather than exactly.
	const measureGutter = useCallback(() => {
		const element = ref.current;
		if (!element || !gutter) return;
		element.style.setProperty(
			"--scroll-gutter",
			`${element.offsetWidth - element.clientWidth}px`,
		);
	}, [gutter, ref]);

	// `overflow-x: hidden` clips a bleed row that reaches past the narrowed
	// padding, but a clipped overflow is still scrollable from script, and
	// focusing that row scrolls it into view — sideways by the bar's width.
	// `.page-scroll` is the only scroller that clips, so only it is put back;
	// the assistant's transcript may hold something that scrolls sideways on
	// purpose.
	const resetSideways = useCallback(() => {
		const element = ref.current;
		if (!element || !gutter) return;
		if (element.scrollLeft !== 0) element.scrollLeft = 0;
	}, [gutter, ref]);

	// A layout effect, so a page that already overflows on mount has its
	// gutter before the first paint rather than widening a frame after it.
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const onScroll = () => {
			measure();
			resetSideways();
		};
		const onResize = () => {
			measure();
			measureGutter();
		};
		onResize();
		element.addEventListener("scroll", onScroll, { passive: true });
		// Content changing height is as much a reason to re-measure as scrolling:
		// a streamed answer growing, a table filtering down to three rows.
		//
		// The CHILDREN are what get observed, because a ResizeObserver reports a
		// border box and the scroller's own never moves — it is `flex-1` in a
		// fixed frame however long the list inside it is.
		//
		// The gutter write resizes every child it was just told about, in the
		// same frame. That is the point — the bar and the narrower padding paint
		// together — and it is also what makes the browser report
		// `ResizeObserver loop completed with undelivered notifications`, which
		// `__root.tsx` keeps out of PostHog.
		const observer = new ResizeObserver(onResize);
		const observeAll = () => {
			// Rebuilt rather than added to: a swapped panel leaves its predecessor
			// detached, and a detached target is an observation that can never
			// report again.
			observer.disconnect();
			observer.observe(element);
			for (const child of element.children) observer.observe(child);
		};
		observeAll();
		// A panel that is REPLACED rather than resized — the sidebar's Browse/Chat
		// swap, which mounts a new element the original observation cannot follow —
		// otherwise left the fade measuring the list that had already gone.
		const children = new MutationObserver(() => {
			observeAll();
			onResize();
		});
		children.observe(element, { childList: true });
		return () => {
			element.removeEventListener("scroll", onScroll);
			observer.disconnect();
			children.disconnect();
		};
	}, [measure, measureGutter, resetSideways, ref]);
}

export function ScrollFade({
	children,
	className,
	viewportRef,
	gutter,
}: {
	children: React.ReactNode;
	className?: string;
	/** Hand the scrollbar's width back out of the right padding, so the content
	 *  keeps its width when a bar comes or goes. Pairs with `.page-scroll`. */
	gutter?: boolean;
	/** Escape hatch for callers that need to drive the scroll position (the
	 *  assistant pins its transcript to the bottom as answers arrive). */
	viewportRef?: React.RefObject<HTMLDivElement | null>;
}) {
	const ownRef = useRef<HTMLDivElement>(null);
	const ref = viewportRef ?? ownRef;
	useScrollFade(ref, { gutter });

	return (
		<div ref={ref} className={cn("scroll-fade", className)}>
			{children}
		</div>
	);
}
