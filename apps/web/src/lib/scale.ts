import { useCallback, useSyncExternalStore } from "react";

// Preferences → Display → Scale: how large the app is drawn, on this device.
//
// It is CSS `zoom` on <html>, the browser's own zoom in one property. It
// scales text, borders, radii, icons and images together, it drives the layout,
// and media queries see the result. A root font size would first need every px
// token (`--fs-*`, `.h1`, `.h2`, `--radius`, `--mobile-nav-h`) converted to rem.
//
// `zoom` gets two things wrong, and `styles.css` corrects them at the call
// sites. A viewport unit or an `env()` inset resolves against the unzoomed
// viewport and then scales, so it comes out too big. Each one divides by
// `--ui-scale` (search for `var(--ui-scale`). A new `svh`, `dvh`, `vw` or
// `env(safe-area-*)` length needs the same division, or it overflows at 150%.
//
// The other is not a length. In a zoomed subtree, Chrome offsets a
// `position: sticky` element by its own `top` on top of its static position,
// when it has a scrollable ancestor. The sidebar island would drop a
// frame-padding at 125% and above. So `.app-frame` is `overflow: clip`, which
// leaves no scroll container, and `.scroll-fade` is `position: relative`, so
// its scrolling cannot count as the frame's overflow.
//
// At a large scale the media queries report a narrower viewport, so a laptop
// gets the mobile layout. This is deliberate and matches browser zoom.
//
// It follows `lib/theme.ts`: it belongs to the device, it applies before the
// first paint, and the DOM is the state.

/** The steps, as percentages. A short list rather than a slider: every value
 *  here is one somebody would choose on purpose, and a scale of 103% is not. */
export const SCALES = [90, 100, 110, 125, 150] as const;

export const DEFAULT_SCALE = 100;

const STORAGE_KEY = "farmer-scale";
const PROPERTY = "--ui-scale";
/** Fired on the window whenever *this* tab changes it — `storage` only reaches
 *  the OTHER tabs. */
const CHANGE_EVENT = "farmer:scale";

const isScale = (value: number) => SCALES.some((step) => step === value);

/** Runs in <head> before anything paints, as part of `displayInitScript` — see
 *  `lib/display-prefs.ts`. */
export const scaleInitScript = `(function(){try{
var s=${JSON.stringify(SCALES)},v=parseInt(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})||"",10);
if(s.indexOf(v)<0||v===${DEFAULT_SCALE})return;
document.documentElement.style.setProperty(${JSON.stringify(PROPERTY)},String(v/100));
}catch(e){}})();`;

const apply = (scale: number) => {
	const root = document.documentElement;
	// 100% writes nothing, so `zoom: var(--ui-scale, 1)` falls back and the
	// default costs no property. The same rule every switch here follows.
	if (scale === DEFAULT_SCALE) root.style.removeProperty(PROPERTY);
	else root.style.setProperty(PROPERTY, String(scale / 100));
};

const read = (): number => {
	const value = Number.parseFloat(
		document.documentElement.style.getPropertyValue(PROPERTY),
	);
	const percent = Math.round(value * 100);
	return isScale(percent) ? percent : DEFAULT_SCALE;
};

/** The scale in effect on this device, as a factor: 1 at 100%, 1.5 at 150%.
 *  For the one reader that is not CSS — `unzoomPagePoint` in `lib/motion.ts`,
 *  which takes the zoom back off the pixels motion measures in. */
export const scaleFactor = (): number =>
	import.meta.env.SSR ? 1 : read() / 100;

export const setScale = (scale: number) => {
	if (!isScale(scale)) return;
	apply(scale);
	try {
		if (scale === DEFAULT_SCALE) localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, String(scale));
	} catch {
		// Private-mode / blocked storage: the choice still applies to this page,
		// it just won't be remembered.
	}
	window.dispatchEvent(new Event(CHANGE_EVENT));
};

if (!import.meta.env.SSR) {
	// Another tab's choice. Listened for here rather than in `subscribe`: that
	// runs only where the steps are on screen, and every open tab has to follow
	// whatever page it is showing. The property here is still the old one, so
	// apply the incoming scale first — the snapshot read that follows reports
	// the DOM.
	window.addEventListener("storage", (event) => {
		if (event.key !== STORAGE_KEY) return;
		const next = Number.parseInt(event.newValue ?? "", 10);
		apply(isScale(next) ? next : DEFAULT_SCALE);
		window.dispatchEvent(new Event(CHANGE_EVENT));
	});
}

const subscribe = (onChange: () => void) => {
	window.addEventListener(CHANGE_EVENT, onChange);
	return () => window.removeEventListener(CHANGE_EVENT, onChange);
};

/** The scale on this device, and the way to change it. Server-renders as 100
 *  and corrects itself on hydration, which only ever moves the selected
 *  option. */
export function useScale() {
	const scale = useSyncExternalStore(subscribe, read, () => DEFAULT_SCALE);
	const set = useCallback((next: number) => setScale(next), []);
	return [scale, set] as const;
}
