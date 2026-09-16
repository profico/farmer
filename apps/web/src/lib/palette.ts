import { useCallback, useSyncExternalStore } from "react";

// Preferences → Display → Colours: the one colour the whole app is drawn from.
//
// Two choices, Vanilla and Custom. Vanilla is the palette `styles.css` has
// always carried, untouched. Custom takes a single seed — a hue and a chroma,
// nothing else — and `styles.css` derives every neutral, the accent, the status
// colours and the chart series from it, the way Material You derives a scheme
// from one source colour.
//
// Built the way `lib/theme.ts` builds light/dark and for the same reasons. The
// choice lives in localStorage, so it belongs to the device; it has to be on
// <html> before the first paint, so an inline script sets it; and the DOM is
// the state, with no provider to disagree with it.
//
// The seed is stored as the two numbers rather than as a hex, so the inline
// script needs `parseFloat` and not a colour-space conversion. Nothing in this
// app converts between colour spaces at all: the wheel picks an angle and a
// radius, CSS turns those into every token, and there is no third place where
// the two could drift apart.
//
// Why the lightness of every role is FIXED, and only hue and chroma move:
// OKLCH lightness is perceptual, so text contrast stays near-constant whatever
// hue somebody picks. A generated palette that also varies lightness cannot
// promise that, and this one has to — see `scripts/check-palette-contrast.ts`,
// which checks the promise across the whole wheel.

export type PaletteMode = "vanilla" | "custom";

/** A hue in degrees and a chroma. The two numbers `styles.css` reads as
 *  `--seed-h` and `--seed-c`. */
export type Seed = { h: number; c: number };

/** The ceiling on the seed's chroma, and the outer edge of the wheel. Past
 *  this, sRGB has nothing left to give at the accent's lightness and the
 *  browser gamut-maps the value back anyway, so the wheel would have a dead
 *  rim. */
export const SEED_MAX_CHROMA = 0.2;

/** Vanilla's own accent, #6f4ebe, measured in OKLCH. Picking Custom lands
 *  here, so the accent, green, amber, red and every chart series stay exactly
 *  where they were and only the greys move — from vanilla's warm ones to the
 *  accent's own hue. That is not a bug in the default: vanilla pairs a WARM
 *  ground with a COOL accent on purpose, and a palette drawn from one seed
 *  cannot hold both. Custom is a sibling of vanilla, not a superset. */
export const VANILLA_SEED: Seed = { h: 293, c: 0.168 };

/** The quick seeds under the wheel. Most people want a colour, not a colour
 *  space, and reaching one in a single click is the difference between a
 *  control and a toy. Every one sits at the same chroma as vanilla's accent,
 *  so none of them arrives louder than the app was drawn to be. */
export const QUICK_SEEDS: readonly { label: string; seed: Seed }[] = [
	{ label: "Violet", seed: VANILLA_SEED },
	{ label: "Indigo", seed: { h: 268, c: 0.16 } },
	{ label: "Blue", seed: { h: 245, c: 0.15 } },
	{ label: "Teal", seed: { h: 195, c: 0.12 } },
	{ label: "Green", seed: { h: 150, c: 0.12 } },
	{ label: "Amber", seed: { h: 75, c: 0.13 } },
	{ label: "Rust", seed: { h: 40, c: 0.14 } },
	{ label: "Crimson", seed: { h: 15, c: 0.16 } },
	{ label: "Magenta", seed: { h: 340, c: 0.16 } },
	{ label: "Slate", seed: { h: 250, c: 0.02 } },
];

const STORAGE_KEY = "farmer-palette";
const ATTRIBUTE = "data-palette";
/** Fired on the window whenever *this* tab changes the choice — `storage` only
 *  reaches the OTHER tabs. */
const CHANGE_EVENT = "farmer:palette";

/**
 * Runs in <head> before anything paints, as part of `displayInitScript` — see
 * `lib/display-prefs.ts`.
 *
 * It feature-tests `oklch()` and `mod()` and applies nothing without both,
 * because the custom palette is written entirely in those two. Half a palette
 * is not a degraded palette: a `var(--bg)` holding an unparsable value is
 * invalid at computed-value time, which paints the app transparent. So this
 * fails closed, to vanilla.
 *
 * The seed is parsed by hand rather than by a regular expression, because a
 * template literal eats `\d` on its way into the emitted script.
 */
export const paletteInitScript = `(function(){try{
var v=(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})||"").split(" ");
if(v[0]!=="custom")return;
var h=parseFloat(v[1]),c=parseFloat(v[2]);
if(!(h>=0&&h<=360&&c>=0&&c<=${SEED_MAX_CHROMA}))return;
if(!(window.CSS&&CSS.supports("color","oklch(0.5 0.1 200)")&&CSS.supports("top","mod(1px,1px)")))return;
var d=document.documentElement;
d.style.setProperty("--seed-h",String(h));
d.style.setProperty("--seed-c",String(c));
d.setAttribute(${JSON.stringify(ATTRIBUTE)},"custom");
}catch(e){}})();`;

/** The same two tests the inline script runs, for the settings screen: a
 *  browser without them is offered Vanilla and told why. */
export const supportsCustomPalette = () =>
	globalThis.CSS?.supports("color", "oklch(0.5 0.1 200)") === true &&
	globalThis.CSS.supports("top", "mod(1px,1px)");

const parse = (stored: string | null): Seed | null => {
	const parts = (stored ?? "").split(" ");
	if (parts[0] !== "custom") return null;
	const h = Number.parseFloat(parts[1] ?? "");
	const c = Number.parseFloat(parts[2] ?? "");
	if (!(h >= 0 && h <= 360)) return null;
	if (!(c >= 0 && c <= SEED_MAX_CHROMA)) return null;
	return { h, c };
};

const apply = (seed: Seed | null) => {
	const root = document.documentElement;
	if (!seed) {
		root.removeAttribute(ATTRIBUTE);
		root.style.removeProperty("--seed-h");
		root.style.removeProperty("--seed-c");
		return;
	}
	root.style.setProperty("--seed-h", String(seed.h));
	root.style.setProperty("--seed-c", String(seed.c));
	root.setAttribute(ATTRIBUTE, "custom");
};

/** The last seed handed out, kept so that an unchanged DOM gives back the SAME
 *  object. `useSyncExternalStore` compares snapshots with `Object.is` and calls
 *  the getter again on every render: a fresh object each time is an infinite
 *  render loop, not a re-read. */
let lastSeed: Seed | null = null;

const readSeed = (): Seed | null => {
	const root = document.documentElement;
	if (root.getAttribute(ATTRIBUTE) !== "custom") {
		lastSeed = null;
		return null;
	}
	const h = Number.parseFloat(root.style.getPropertyValue("--seed-h"));
	const c = Number.parseFloat(root.style.getPropertyValue("--seed-c"));
	if (!lastSeed || lastSeed.h !== h || lastSeed.c !== c) lastSeed = { h, c };
	return lastSeed;
};

/** Dragging the wheel is a hundred changes a second, and every one of them
 *  repaints the app. The paint is the point; the write is not, so it waits for
 *  the drag to settle. */
let writeTimer: ReturnType<typeof setTimeout> | undefined;

const write = (value: string | null) => {
	clearTimeout(writeTimer);
	writeTimer = setTimeout(() => {
		try {
			if (value === null) localStorage.removeItem(STORAGE_KEY);
			else localStorage.setItem(STORAGE_KEY, value);
		} catch {
			// Private-mode / blocked storage: the choice still applies to this
			// page, it just won't be remembered.
		}
	}, 200);
};

export const setPaletteSeed = (seed: Seed | null) => {
	apply(seed);
	write(seed ? `custom ${seed.h} ${seed.c}` : null);
	window.dispatchEvent(new Event(CHANGE_EVENT));
};

if (!import.meta.env.SSR) {
	// Another tab's choice. Listened for here rather than in `subscribe`: that
	// runs only where the wheel is on screen, and every open tab has to follow
	// whatever page it is showing. The attribute here is still the old one, so
	// apply the incoming seed first — the snapshot read that follows reports
	// the DOM.
	window.addEventListener("storage", (event) => {
		if (event.key !== STORAGE_KEY) return;
		apply(parse(event.newValue));
		window.dispatchEvent(new Event(CHANGE_EVENT));
	});
}

const subscribe = (onChange: () => void) => {
	window.addEventListener(CHANGE_EVENT, onChange);
	return () => window.removeEventListener(CHANGE_EVENT, onChange);
};

/** The colour choice on this device, and the two ways to change it.
 *  Server-renders as vanilla and corrects itself on hydration, which only ever
 *  moves the selected option. */
export function usePalette() {
	const seed = useSyncExternalStore(
		subscribe,
		readSeed,
		(): Seed | null => null,
	);
	const setVanilla = useCallback(() => setPaletteSeed(null), []);
	const setCustom = useCallback((next: Seed) => setPaletteSeed(next), []);
	const mode: PaletteMode = seed ? "custom" : "vanilla";
	return { mode, seed: seed ?? VANILLA_SEED, setVanilla, setCustom };
}
