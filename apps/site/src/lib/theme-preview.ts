import { useEffect, useRef } from "react";
import type { PointerEvent } from "react";

/*
 * "Make it yours" on the front page: while the pointer is on the card, the
 * page takes a hue from where the pointer is, left to right. The light or
 * dark theme stays as it is, and nothing is stored.
 *
 * The preview is `data-preview` and `--preview-hue` on <html>; the palette
 * in `front.css` reads them. The new color grows out of the card to the whole
 * page in a view transition and shrinks back into the card on the way out.
 * While the pointer moves, the hue follows it directly, and the cursor is a
 * dot of that color.
 */

const root = () => document.documentElement;

const stillMotion = () =>
	root().dataset.motion === "reduce" ||
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The card's box, where the transition starts and ends. */
function setOrigin(card: DOMRect) {
	const style = root().style;
	style.setProperty("--bleed-t", `${card.top}px`);
	style.setProperty("--bleed-r", `${window.innerWidth - card.right}px`);
	style.setProperty("--bleed-b", `${window.innerHeight - card.bottom}px`);
	style.setProperty("--bleed-l", `${card.left}px`);
}

/** A dot of the hue, as a cursor. */
const cursor = (hue: number) => {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="8" fill="hsl(${hue} 65% 55%)" stroke="white" stroke-width="2.5"/><circle cx="12" cy="12" r="10" fill="none" stroke="rgb(0 0 0 / 0.25)"/></svg>`;
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`;
};

const within = (box: DOMRect, x: number, y: number) =>
	x > box.left && x < box.right && y > box.top && y < box.bottom;

export function useThemePreview() {
	// Whether the preview is on. It changes when the change is asked for, not
	// when the transition paints it.
	const on = useRef(false);
	const running = useRef<ViewTransition | null>(null);

	const change = (kind: "out" | "in", apply: () => void) => {
		// A new change starts from what is on screen now.
		running.current?.skipTransition();
		if (!document.startViewTransition || stillMotion()) {
			apply();
			return;
		}
		root().dataset.bleed = kind;
		const transition = document.startViewTransition(apply);
		running.current = transition;
		void transition.finished.finally(() => {
			if (running.current !== transition) return;
			running.current = null;
			delete root().dataset.bleed;
		});
	};

	const restore = () => {
		delete root().dataset.preview;
		root().style.removeProperty("--preview-hue");
	};

	// The page must never keep a preview, for example after a route change.
	useEffect(
		() => () => {
			if (on.current) restore();
			on.current = false;
		},
		[],
	);

	/** The hue under the pointer; the cursor takes it too. */
	const hueAt = (event: PointerEvent<HTMLElement>) => {
		const card = event.currentTarget.getBoundingClientRect();
		const x = (event.clientX - card.left) / card.width;
		const hue = Math.round(Math.min(1, Math.max(0, x)) * 359);
		// Steps of 6 degrees, so the cursor image is not rebuilt on every pixel.
		event.currentTarget.style.cursor = cursor(hue - (hue % 6));
		return hue;
	};

	const leave = (element: HTMLElement) => {
		on.current = false;
		element.style.removeProperty("cursor");
		setOrigin(element.getBoundingClientRect());
		change("in", restore);
	};

	return {
		onPointerEnter: (event: PointerEvent<HTMLElement>) => {
			if (event.pointerType !== "mouse" || on.current) return;
			on.current = true;
			const hue = hueAt(event);
			setOrigin(event.currentTarget.getBoundingClientRect());
			change("out", () => {
				root().dataset.preview = "";
				root().style.setProperty("--preview-hue", String(hue));
			});
		},
		onPointerMove: (event: PointerEvent<HTMLElement>) => {
			if (event.pointerType !== "mouse" || !on.current) return;
			root().style.setProperty("--preview-hue", String(hueAt(event)));
		},
		onPointerLeave: (event: PointerEvent<HTMLElement>) => {
			if (!on.current) return;
			const element = event.currentTarget;
			if (
				!within(element.getBoundingClientRect(), event.clientX, event.clientY)
			) {
				leave(element);
				return;
			}
			// A view transition starts with a leave while the pointer is still
			// here, and the card gets no event when the pointer really goes.
			// So the window watches for it.
			const watch = (move: globalThis.PointerEvent) => {
				if (!on.current) {
					window.removeEventListener("pointermove", watch);
				} else if (
					!within(element.getBoundingClientRect(), move.clientX, move.clientY)
				) {
					window.removeEventListener("pointermove", watch);
					leave(element);
				}
			};
			window.addEventListener("pointermove", watch);
		},
	};
}
