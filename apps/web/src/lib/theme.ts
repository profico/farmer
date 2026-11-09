import { useSyncExternalStore } from "react";

// Light/dark switching. The palettes already exist in `styles.css` — both are
// written out in full and everything else is derived from them, so the whole
// mechanism here is "which value does `data-theme` on <html> hold".
//
// The DOM attribute IS the state. There is no provider and no React store on
// purpose: the theme has to be applied before the first paint (see
// `themeInitScript`), which happens long before React exists, so any second
// copy of it in component state would start out as a guess that has to be
// reconciled. `useTheme` reads the attribute back instead.

export type Theme = "light" | "dark";

const STORAGE_KEY = "farmer-theme";
/** Fired on the window whenever *this* tab changes the theme — `storage` only
 *  reaches the OTHER tabs, so it can't keep two toggles on one page in sync. */
const CHANGE_EVENT = "farmer:theme";

/** Runs in <head> before anything paints — see `__root.tsx`.
 *
 *  Inline and blocking on purpose: the server has no way to know the reader's
 *  choice (it lives in localStorage, which is why this can't be an SSR prop),
 *  so the alternative is painting the light palette and swapping it on hydrate,
 *  i.e. a full-page white flash on every navigation into the app.
 *
 *  No stored choice means follow the OS. Stored means the reader has said
 *  otherwise at least once, and that outranks the OS from then on. */
export const themeInitScript = `(function(){try{var s=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});var t=s==="dark"||s==="light"?s:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

const readTheme = (): Theme =>
	document.documentElement.getAttribute("data-theme") === "dark"
		? "dark"
		: "light";

const hasStoredTheme = () => {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored === "dark" || stored === "light";
	} catch {
		return false;
	}
};

export const setTheme = (theme: Theme) => {
	document.documentElement.setAttribute("data-theme", theme);
	try {
		localStorage.setItem(STORAGE_KEY, theme);
	} catch {
		// Private-mode / blocked storage: the switch still works for this page,
		// it just won't be remembered. Not worth failing the click over.
	}
	window.dispatchEvent(new Event(CHANGE_EVENT));
};

const subscribe = (onChange: () => void) => {
	// A `storage` event is another tab's switch, so the attribute here is still
	// the old one — apply it first, or the snapshot read that follows returns
	// what this tab already had and nothing repaints.
	const onStorage = (event: StorageEvent) => {
		if (event.key !== STORAGE_KEY) return;
		const next = event.newValue === "dark" ? "dark" : "light";
		document.documentElement.setAttribute("data-theme", next);
		onChange();
	};
	// No stored choice follows the OS, so an OS switch repaints the open page.
	const os = window.matchMedia("(prefers-color-scheme: dark)");
	const onOs = () => {
		if (hasStoredTheme()) return;
		document.documentElement.setAttribute(
			"data-theme",
			os.matches ? "dark" : "light",
		);
		onChange();
	};
	window.addEventListener(CHANGE_EVENT, onChange);
	window.addEventListener("storage", onStorage);
	os.addEventListener("change", onOs);
	return () => {
		window.removeEventListener(CHANGE_EVENT, onChange);
		window.removeEventListener("storage", onStorage);
		os.removeEventListener("change", onOs);
	};
};

/** The current theme, plus the two ways to change it. Server-renders as light —
 *  the same guess `styles.css` makes — and corrects itself on hydration, which
 *  only ever moves an icon. */
export function useTheme() {
	const theme = useSyncExternalStore(
		subscribe,
		readTheme,
		(): Theme => "light",
	);
	return {
		theme,
		setTheme,
		toggle: () => setTheme(theme === "dark" ? "light" : "dark"),
	};
}
