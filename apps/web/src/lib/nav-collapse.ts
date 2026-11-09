import { useSyncExternalStore } from "react";

// Whether the shell's nav column is an icon rail or a labelled sidebar.
//
// It follows `lib/theme.ts`. The choice lives in localStorage, so it belongs to
// the device. An inline script puts it on <html> before the first paint, so the
// sidebar does not open wide and then shut on hydrate. The attribute is the
// state, and `styles.css` sizes `.app-nav` off it.
//
// A section panel (Settings, Chat) also collapses the column. The URL decides
// that, and the server knows the URL, so it uses a `data-panel` attribute and
// not this module.
//
// A narrow window also collapses it, and overrides the reader's choice without
// replacing it. Between 768px (below it the tab bar takes over) and 1024px, a
// labelled column costs 184px of an already narrow content area. This module
// reads the window, not a CSS media query, so that `data-nav` stays the one
// source of truth for every rule in `styles.css`. A wider window gives the
// reader's choice back.

const STORAGE_KEY = "farmer-nav-rail";
const ATTRIBUTE = "data-nav";
const VALUE = "rail";
/** Below `lg`. Tailwind's breakpoint, so the content's container queries and
 *  the column that sets their width agree about where a tablet starts. */
const NARROW = "(max-width: 63.999rem)";
/** Fired on the window whenever *this* tab collapses or expands — `storage`
 *  only reaches the OTHER tabs. */
const CHANGE_EVENT = "farmer:nav-collapse";

/** Runs in <head> before anything paints, beside `themeInitScript` — see
 *  `__root.tsx`. The window check is in here too: a tablet that opened the
 *  column wide and shut it on hydrate is the flash this script exists to
 *  prevent, and it is the widest one in the app. */
export const navInitScript = `(function(){try{var n=matchMedia(${JSON.stringify(NARROW)}).matches;if(n||localStorage.getItem(${JSON.stringify(STORAGE_KEY)})==="1")document.documentElement.setAttribute(${JSON.stringify(ATTRIBUTE)},${JSON.stringify(VALUE)});}catch(e){}})();`;

const read = () => document.documentElement.getAttribute(ATTRIBUTE) === VALUE;

const isNarrow = () => window.matchMedia(NARROW).matches;

const stored = () => {
	try {
		return localStorage.getItem(STORAGE_KEY) === "1";
	} catch {
		return false;
	}
};

const apply = (collapsed: boolean) => {
	if (collapsed) document.documentElement.setAttribute(ATTRIBUTE, VALUE);
	else document.documentElement.removeAttribute(ATTRIBUTE);
};

/** The attribute, from both halves of the answer. Called on every input — a
 *  click, another tab, a resize — so the two can never disagree. */
const sync = () => apply(stored() || isNarrow());

export const setNavCollapsed = (collapsed: boolean) => {
	try {
		localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
	} catch {
		// Private-mode / blocked storage: the toggle still works for this page, it
		// just won't be remembered. Not worth failing the click over.
	}
	// Written first, then read back through `sync`: on a narrow window the
	// column stays a rail whatever was just asked for, and expanding is what the
	// reader gets back when the window grows.
	sync();
	window.dispatchEvent(new Event(CHANGE_EVENT));
};

const subscribe = (onChange: () => void) => {
	// A `storage` event is another tab's toggle, so the attribute here is still
	// the old one — apply it first, or the snapshot read that follows returns
	// what this tab already had and nothing repaints.
	const onStorage = (event: StorageEvent) => {
		if (event.key !== STORAGE_KEY) return;
		sync();
		onChange();
	};
	// Resizing past the breakpoint is the same kind of input as a click, so it
	// goes through `sync` for the same reason.
	const media = window.matchMedia(NARROW);
	const onMedia = () => {
		sync();
		onChange();
	};
	window.addEventListener(CHANGE_EVENT, onChange);
	window.addEventListener("storage", onStorage);
	media.addEventListener("change", onMedia);
	return () => {
		window.removeEventListener(CHANGE_EVENT, onChange);
		window.removeEventListener("storage", onStorage);
		media.removeEventListener("change", onMedia);
	};
};

/** Whether the reader has collapsed the nav column. Server-renders as `false`
 *  — the CSS above has already sized the column correctly by then, so the one
 *  frame this is wrong only ever draws labels inside a box that clips them. */
export function useNavCollapsed() {
	return useSyncExternalStore(subscribe, read, () => false);
}

/** Whether the window — rather than the reader — is what is holding the column
 *  shut. The toggle reads it and steps aside: a button that cannot expand the
 *  column is worse than no button, and the reader's own choice is still stored
 *  under it, waiting for a wider window. Server-renders as `false`, like the
 *  hook above and for the same reason. */
export function useNavForced() {
	return useSyncExternalStore(subscribe, isNarrow, () => false);
}
