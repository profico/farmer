import { MotionGlobalConfig } from "motion/react";
import { useCallback, useSyncExternalStore } from "react";

import { applyFaces, fontsInitScript } from "./fonts.ts";
import { paletteInitScript } from "./palette.ts";
import { scaleInitScript } from "./scale.ts";

// Preferences → Display: switches that change how the app looks on this device.
// Every one is off by default.
//
// The section also holds three settings that carry a VALUE rather than a
// switch — the colors, the three faces and the scale. Each owns its own
// module, because each has real work to do (a color scheme, a font catalogue,
// a list of steps), and each exports one before-paint script. This module
// concatenates the four into `displayInitScript`, so `__root.tsx` names one
// thing and the whole of Preferences → Display arrives before the first paint.
//
// Built the way `lib/theme.ts` builds light/dark, for the same reasons. The
// choice lives in localStorage, so it belongs to the device. It has to be on
// <html> before the first paint, or every cold load shows the default and then
// swaps it, so an inline script sets it. And the DOM attribute is the state,
// with no provider to disagree with it. `styles.css` does the rest from the
// attribute.

const PREFS = {
	/** Page titles and the big numbers in Instrument Sans instead of Instrument
	 *  Serif: `--serif` points at the sans face. */
	boringFont: {
		key: "farmer-boring-font",
		attribute: "data-font",
		value: "sans",
	},
	/** Every CSS animation and transition ends at once, and so does every
	 *  Motion animation (`syncMotion`). */
	lessMotion: {
		key: "farmer-less-motion",
		attribute: "data-motion",
		value: "reduce",
	},
	/** Less padding above and below the text of a table row
	 *  (`--table-cell-py`). */
	compactTables: {
		key: "farmer-compact-tables",
		attribute: "data-density",
		value: "compact",
	},
	/** Every mark drawn harder on the same paper: muted and faint text, the
	 *  hairlines, the accent, the status colors and the focus ring. The
	 *  surfaces do not move — see the high-contrast blocks in `styles.css`. */
	highContrast: {
		key: "farmer-high-contrast",
		attribute: "data-contrast",
		value: "high",
	},
} as const;

export type DisplayPref = keyof typeof PREFS;
type Pref = (typeof PREFS)[DisplayPref];

/** Fired on the window whenever *this* tab changes one — `storage` only
 *  reaches the OTHER tabs. */
const CHANGE_EVENT = "farmer:display-prefs";

/** Runs in <head> before anything paints, beside `themeInitScript` — see
 *  `__root.tsx`. The switches first: the font script reads "Boring font" back
 *  out of storage, and the ORDER is what keeps `data-font` on <html> by the
 *  time anything else asks. */
export const displayInitScript =
	`(function(){try{var p=${JSON.stringify(Object.values(PREFS))};for(var i=0;i<p.length;i++){if(localStorage.getItem(p[i].key)==="1")document.documentElement.setAttribute(p[i].attribute,p[i].value);}}catch(e){}})();` +
	paletteInitScript +
	fontsInitScript +
	scaleInitScript;

const read = (pref: Pref) =>
	document.documentElement.getAttribute(pref.attribute) === pref.value;

/**
 * Motion animates in JS, where the CSS rule for "Less movement" cannot reach.
 * `instantAnimations` puts every Motion animation on its end state at once and
 * still calls its completion callbacks, so a sidebar row that waits for its
 * opening to end still settles.
 */
const syncMotion = () => {
	MotionGlobalConfig.instantAnimations = read(PREFS.lessMotion);
};

const apply = (pref: Pref, on: boolean) => {
	if (on) document.documentElement.setAttribute(pref.attribute, pref.value);
	else document.documentElement.removeAttribute(pref.attribute);
	syncMotion();
	// "Boring font" decides whether the chosen display face is written to <html>
	// at all: an inline property beats the `:root[data-font='sans']` rule that
	// the switch works through, whatever that rule's selector. So moving the
	// switch has to take the display face off <html>, or put it back.
	applyFaces();
};

if (!import.meta.env.SSR) {
	// The inline script has set the attributes before this module runs, and this
	// module runs before hydration, so the first animation already knows.
	syncMotion();
	// Another tab's switch. Listened for here, not in `subscribe`: that runs only
	// where a switch is on screen, and every open tab has to follow, whatever
	// page it shows.
	window.addEventListener("storage", (event) => {
		const pref = Object.values(PREFS).find((p) => p.key === event.key);
		if (!pref) return;
		apply(pref, event.newValue === "1");
		window.dispatchEvent(new Event(CHANGE_EVENT));
	});
}

const setDisplayPref = (name: DisplayPref, on: boolean) => {
	const pref = PREFS[name];
	apply(pref, on);
	try {
		if (on) localStorage.setItem(pref.key, "1");
		else localStorage.removeItem(pref.key);
	} catch {
		// Private-mode / blocked storage: the switch still works for this page,
		// it just won't be remembered.
	}
	window.dispatchEvent(new Event(CHANGE_EVENT));
};

const subscribe = (onChange: () => void) => {
	window.addEventListener(CHANGE_EVENT, onChange);
	return () => window.removeEventListener(CHANGE_EVENT, onChange);
};

/** Whether this device has a Display preference on, and the way to change it.
 *  Server-renders as off and corrects itself on hydration, which only ever
 *  moves the switch. */
export function useDisplayPref(name: DisplayPref) {
	const on = useSyncExternalStore(
		subscribe,
		() => read(PREFS[name]),
		() => false,
	);
	const set = useCallback(
		(next: boolean) => setDisplayPref(name, next),
		[name],
	);
	return [on, set] as const;
}
