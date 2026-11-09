import { useCallback, useLayoutEffect, useRef } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * A scroll region that fades at whichever edge has more content behind it.
 *
 * The fade is a mask on the scroller, not an overlay. An overlay must match the
 * island's color, and it blocks pointer events at the edge. A mask fades the
 * content in any theme and takes no events.
 *
 * It measures in JS (scroll listener and ResizeObserver) because
 * `animation-timeline: scroll()` is still Chromium-only.
 *
 * The top and bottom edges are separate custom properties, because they differ:
 * at rest there is nothing above, and a short page has neither edge.
 *
 * This hook keeps `--fade-top` / `--fade-bottom` on `ref` in step with the
 * scroll position. Pair it with the `scroll-fade` class, which turns the two
 * lengths into the mask.
 *
 * It is a separate hook so that the sidebar's `SidebarContent` can use it
 * without a wrapper div.
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
