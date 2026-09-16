import { useSyncExternalStore } from "react";

// Whether the shell's nav column is an icon rail or a labelled sidebar.
//
// Built the way `lib/theme.ts` builds light/dark, for the same reasons. The
// choice lives in localStorage, so it belongs to the device. It has to be on
// <html> before the first paint — a collapsed sidebar that opens wide and then
// shuts on hydrate is worse than one that was never collapsed — so an inline
// script sets it. And the attribute IS the state, with no provider to disagree
// with it: `styles.css` sizes `.app-nav` off it, so the width is right on the
// first frame even though React only catches up a frame later.
//
// The reader's choice is not the only thing that collapses the column. A
// section panel (Settings, Chat) collapses it too, and that one is decided by
// the URL, which the server knows — so it rides a `data-panel` attribute on the
// element rather than through here.

const STORAGE_KEY = "farmer-nav-rail";
const ATTRIBUTE = "data-nav";
const VALUE = "rail";
/** Fired on the window whenever *this* tab collapses or expands — `storage`
 *  only reaches the OTHER tabs. */
const CHANGE_EVENT = "farmer:nav-collapse";

/** Runs in <head> before anything paints, beside `themeInitScript` — see
 *  `__root.tsx`. */
export const navInitScript = `(function(){try{if(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})==="1")document.documentElement.setAttribute(${JSON.stringify(ATTRIBUTE)},${JSON.stringify(VALUE)});}catch(e){}})();`;

const read = () => document.documentElement.getAttribute(ATTRIBUTE) === VALUE;

const apply = (collapsed: boolean) => {
	if (collapsed) document.documentElement.setAttribute(ATTRIBUTE, VALUE);
	else document.documentElement.removeAttribute(ATTRIBUTE);
};

export const setNavCollapsed = (collapsed: boolean) => {
	apply(collapsed);
	try {
		localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
	} catch {
		// Private-mode / blocked storage: the toggle still works for this page, it
		// just won't be remembered. Not worth failing the click over.
	}
	window.dispatchEvent(new Event(CHANGE_EVENT));
};

const subscribe = (onChange: () => void) => {
	// A `storage` event is another tab's toggle, so the attribute here is still
	// the old one — apply it first, or the snapshot read that follows returns
	// what this tab already had and nothing repaints.
	const onStorage = (event: StorageEvent) => {
		if (event.key !== STORAGE_KEY) return;
		apply(event.newValue === "1");
		onChange();
	};
	window.addEventListener(CHANGE_EVENT, onChange);
	window.addEventListener("storage", onStorage);
	return () => {
		window.removeEventListener(CHANGE_EVENT, onChange);
		window.removeEventListener("storage", onStorage);
	};
};

/** Whether the reader has collapsed the nav column. Server-renders as `false`
 *  — the CSS above has already sized the column correctly by then, so the one
 *  frame this is wrong only ever draws labels inside a box that clips them. */
export function useNavCollapsed() {
	return useSyncExternalStore(subscribe, read, () => false);
}
