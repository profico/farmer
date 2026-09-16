import { useSyncExternalStore } from "react";

// Preferences → Display → Colours: which neutrals the app is drawn in.
//
// Built exactly the way `lib/theme.ts` builds light/dark and for the same
// reasons. The choice lives in localStorage, so it belongs to the device; it
// has to be on <html> before the first paint, so an inline script sets it; and
// the DOM attribute is the state, with no provider to disagree with it. The
// palettes themselves are written out in `styles.css`, one light and one dark
// block per choice, keyed on `data-palette`. No attribute is the default.
//
// A choice swaps only the neutrals: ground, island, band, text and the
// hairlines. The accent, green/amber/red and the task group colours are the
// same in every one, so a verdict or an action reads the same whatever someone
// picked.

export type PaletteId =
	| "default"
	| "violet"
	| "teal"
	| "graphite"
	| "cocoa"
	| "lilac";

export type Palette = {
	id: PaletteId;
	label: string;
	/** Ground, island, band and text, for the swatch in Preferences. The same
	 *  values as `styles.css`; they are only ever drawn, never applied. */
	swatch: { light: readonly string[]; dark: readonly string[] };
};

export const PALETTES: readonly Palette[] = [
	{
		id: "default",
		label: "Warm grey",
		swatch: {
			light: ["#efece5", "#faf9f6", "#f4f2ed", "#1b1a17"],
			dark: ["#0e0d0a", "#1a1914", "#232219", "#ede8de"],
		},
	},
	{
		id: "violet",
		label: "Violet grey",
		swatch: {
			light: ["#f1f0f5", "#fcfcfd", "#f3f2f7", "#111016"],
			dark: ["#0a090c", "#141317", "#1d1c22", "#f1f0f4"],
		},
	},
	{
		id: "teal",
		label: "Teal",
		swatch: {
			light: ["#e2ecec", "#f8fbfb", "#ecf3f3", "#131b1c"],
			dark: ["#091112", "#121c1e", "#1b282a", "#eef3ef"],
		},
	},
	{
		id: "graphite",
		label: "Graphite",
		swatch: {
			light: ["#ece9e5", "#fbfaf9", "#f3f1ee", "#1b1916"],
			dark: ["#0f0e0d", "#191816", "#24221f", "#efebe5"],
		},
	},
	{
		id: "cocoa",
		label: "Cocoa",
		swatch: {
			light: ["#f1e7e2", "#fdfaf8", "#f7efec", "#201713"],
			dark: ["#0f0b09", "#1a1411", "#261d19", "#f7ece5"],
		},
	},
	{
		id: "lilac",
		label: "Lilac",
		swatch: {
			light: ["#ebe7f3", "#fbfafe", "#f2f0f8", "#1b1721"],
			dark: ["#121017", "#1f1b27", "#2c2635", "#f6f1fb"],
		},
	},
];

const STORAGE_KEY = "farmer-palette";
const ATTRIBUTE = "data-palette";
/** Fired on the window whenever *this* tab changes the choice — `storage` only
 *  reaches the OTHER tabs. */
const CHANGE_EVENT = "farmer:palette";

/** The ids a stored value may be; anything else is ignored, so a stale or
 *  hand-edited value falls back to the default instead of to no palette. */
const STORED_IDS = PALETTES.filter((p) => p.id !== "default").map((p) => p.id);

/** Runs in <head> before anything paints, beside `themeInitScript` — see
 *  `__root.tsx`. */
export const paletteInitScript = `(function(){try{var v=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(${JSON.stringify(STORED_IDS)}.indexOf(v)>-1)document.documentElement.setAttribute(${JSON.stringify(ATTRIBUTE)},v);}catch(e){}})();`;

const toPaletteId = (value: string | null): PaletteId =>
	PALETTES.find((p) => p.id === value)?.id ?? "default";

const readPalette = (): PaletteId =>
	toPaletteId(document.documentElement.getAttribute(ATTRIBUTE));

const apply = (id: PaletteId) => {
	if (id === "default") document.documentElement.removeAttribute(ATTRIBUTE);
	else document.documentElement.setAttribute(ATTRIBUTE, id);
};

export const setPalette = (id: PaletteId) => {
	apply(id);
	try {
		if (id === "default") localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, id);
	} catch {
		// Private-mode / blocked storage: the choice still applies to this page,
		// it just won't be remembered.
	}
	window.dispatchEvent(new Event(CHANGE_EVENT));
};

const subscribe = (onChange: () => void) => {
	// Another tab's choice: apply it first, or the read that follows returns the
	// attribute this tab already had and nothing repaints.
	const onStorage = (event: StorageEvent) => {
		if (event.key !== STORAGE_KEY) return;
		apply(toPaletteId(event.newValue));
		onChange();
	};
	window.addEventListener(CHANGE_EVENT, onChange);
	window.addEventListener("storage", onStorage);
	return () => {
		window.removeEventListener(CHANGE_EVENT, onChange);
		window.removeEventListener("storage", onStorage);
	};
};

/** The colour choice on this device, and the way to change it. Server-renders
 *  as the default and corrects itself on hydration, which only ever moves the
 *  selected option. */
export function usePalette() {
	const palette = useSyncExternalStore(
		subscribe,
		readPalette,
		(): PaletteId => "default",
	);
	return { palette, setPalette };
}
