import { useEffect, useRef } from "react";
import type { PointerEvent } from "react";

import { STORAGE_KEY } from "./theme.ts";

/*
 * "Make it yours" on the front page: while the pointer is on the card, the
 * whole page takes the colors under it. Left to right is the hue, the top
 * half is light and the bottom half is dark.
 *
 * The preview is three things on <html>: `data-preview` (the palette in
 * `front.css` reads `--preview-hue`), `--preview-hue`, and `data-theme`. Leaving
 * the card puts back the theme the reader had; nothing is stored.
 *
 * The page changes in a view transition: the new colors grow out of the card
 * to the whole page, a flip between light and dark spreads from the pointer,
 * and on the way out the preview shrinks back into the card. The hue follows
 * the pointer directly, with no transition.
 */

type Theme = "light" | "dark";

const root = () => document.documentElement;

/** The reader's own theme, read the way `themeInitScript` reads it. */
function ownTheme(): Theme {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === "light" || stored === "dark") return stored;
	} catch {
		// Blocked storage: fall back to the system, as the page did on load.
	}
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

const stillMotion = () =>
	root().dataset.motion === "reduce" ||
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Where the transition starts: the card's box, or a point for a flip. */
function setOrigin(card: DOMRect, x: number, y: number) {
	const style = root().style;
	style.setProperty("--bleed-t", `${card.top}px`);
	style.setProperty("--bleed-r", `${window.innerWidth - card.right}px`);
	style.setProperty("--bleed-b", `${window.innerHeight - card.bottom}px`);
	style.setProperty("--bleed-l", `${card.left}px`);
	style.setProperty("--bleed-x", `${x}px`);
	style.setProperty("--bleed-y", `${y}px`);
}

export function useThemePreview() {
	// The theme on screen while the pointer is on the card, or null. It changes
	// when the change is asked for, not when the transition paints it.
	const shown = useRef<Theme | null>(null);
	const running = useRef<ViewTransition | null>(null);

	const change = (kind: "out" | "flip" | "in", apply: () => void) => {
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
		const html = root();
		delete html.dataset.preview;
		html.style.removeProperty("--preview-hue");
		html.dataset.theme = ownTheme();
	};

	// The page must never keep a preview, for example after a route change.
	useEffect(
		() => () => {
			if (shown.current) restore();
			shown.current = null;
		},
		[],
	);

	/** The hue and the theme under the pointer, and the swatch's ring. */
	const read = (event: PointerEvent<HTMLElement>) => {
		const card = event.currentTarget.getBoundingClientRect();
		const x = Math.min(
			1,
			Math.max(0, (event.clientX - card.left) / card.width),
		);
		const y = Math.min(
			1,
			Math.max(0, (event.clientY - card.top) / card.height),
		);
		const hue = Math.round(x * 359);
		const theme: Theme = y < 0.5 ? "light" : "dark";
		const ring =
			event.currentTarget.querySelector<HTMLElement>(".fp-scene-ring");
		if (ring) {
			ring.style.left = `${x * 100}%`;
			ring.style.top = `${y * 100}%`;
		}
		const readout =
			event.currentTarget.querySelector<HTMLElement>(".fp-scene-readout");
		if (readout) {
			readout.textContent = `${theme === "light" ? "Light" : "Dark"} · ${hue}°`;
		}
		setOrigin(card, event.clientX, event.clientY);
		return { hue, theme };
	};

	function leave(card: DOMRect, x: number, y: number) {
		shown.current = null;
		setOrigin(card, x, y);
		change("in", restore);
	}

	const paint = (hue: number, theme: Theme) => {
		const html = root();
		html.dataset.preview = "";
		html.style.setProperty("--preview-hue", String(hue));
		html.dataset.theme = theme;
	};

	return {
		onPointerEnter: (event: PointerEvent<HTMLElement>) => {
			if (event.pointerType !== "mouse" || shown.current) return;
			const { hue, theme } = read(event);
			shown.current = theme;
			change("out", () => paint(hue, theme));
		},
		onPointerMove: (event: PointerEvent<HTMLElement>) => {
			if (event.pointerType !== "mouse" || !shown.current) return;
			const { hue, theme } = read(event);
			root().style.setProperty("--preview-hue", String(hue));
			if (theme === shown.current) return;
			shown.current = theme;
			change("flip", () => paint(hue, theme));
		},
		onPointerLeave: (event: PointerEvent<HTMLElement>) => {
			if (!shown.current) return;
			const element = event.currentTarget;
			const card = element.getBoundingClientRect();
			if (!within(card, event.clientX, event.clientY)) {
				leave(card, event.clientX, event.clientY);
				return;
			}
			// A view transition starts with a leave while the pointer is still
			// here, and the card gets no event when the pointer really goes.
			// So the window watches for it.
			const watch = (move: globalThis.PointerEvent) => {
				const box = element.getBoundingClientRect();
				if (!shown.current) {
					window.removeEventListener("pointermove", watch);
				} else if (!within(box, move.clientX, move.clientY)) {
					window.removeEventListener("pointermove", watch);
					leave(box, move.clientX, move.clientY);
				}
			};
			window.addEventListener("pointermove", watch);
		},
	};
}

const within = (box: DOMRect, x: number, y: number) =>
	x > box.left && x < box.right && y > box.top && y < box.bottom;
