// The browser chrome's color: the status bar of the installed PWA, the tab
// strip on a phone browser, the title bar on a desktop one.
//
// It is the ground — `--ground`, the surface the islands stand on and the only
// thing visible around them — so the chrome reads as part of the page below
// it. It used to be the logo violet, which drew a purple band across the top
// of every screen, in both themes, over content that has no violet surface
// anywhere in it.
//
// A static `<meta name="theme-color">` cannot say this, because the ground is
// not one color: light and dark hold different literals, and Custom
// (Preferences → Display → Colors) derives it from a seed. `media=` on the
// meta follows the OS, not the stored choice. So the value is written by
// script, in two steps:
//
//   1. `themeColorInitScript`, inline in <head> after the theme script: the
//      vanilla ground of whichever theme `data-theme` holds. A guess, made
//      before the stylesheet exists — exact for vanilla, the nearest grey for
//      Custom — so the chrome is right at first paint rather than wrong for a
//      frame.
//   2. `startThemeColorSync`, once React is up: `--ground` off <html>, re-read
//      whenever `data-theme`, `data-palette` or the seed changes.
//
// Two things here are load-bearing, and both were got wrong the first time:
//
// **The value must be sRGB, written as `#rrggbb`.** Under a custom palette
// `--ground` computes to an `oklch()` expression, and a platform that cannot
// parse the meta's content does not fall back to something sensible — it
// ignores the meta and uses the WEB MANIFEST's `theme_color` instead, which on
// an installed app is whatever was cached at install time. That is how a
// correct-looking `oklch()` meta still showed the old violet on Android.
// `toSrgbHex` puts every value through a 1×1 canvas, which resolves any color
// the browser can parse — hex, `rgb()`, `oklch()` — down to three bytes.
//
// **The source is `--ground`, not the body's computed background.** The body
// resolves to `--bg`, the island paper, one step lighter than the ground; the
// chrome then sat a shade off the strip directly under it. Reading the token
// says which surface is meant and does not depend on which element ends up
// painting it.
//
// The two literals below are copies of `--ground` in `styles.css`. Keep them
// in step: a drift shows as one frame of the old color on a cold load.

const VANILLA_GROUND = { light: "#efece5", dark: "#0e0d0a" } as const;

const SELECTOR = 'meta[name="theme-color"]';

/** Runs in <head> before anything paints — see `__root.tsx`. Must follow
 *  `themeInitScript`, which is what puts `data-theme` on <html>. */
export const themeColorInitScript = `(function(){try{var m=document.createElement("meta");m.name="theme-color";m.content=document.documentElement.getAttribute("data-theme")==="dark"?${JSON.stringify(VANILLA_GROUND.dark)}:${JSON.stringify(VANILLA_GROUND.light)};document.head.appendChild(m);}catch(e){}})();`;

/** One canvas for the life of the page. `willReadFrequently` because this is a
 *  read-back, which is the slow path on a GPU-backed surface. */
let ctx: CanvasRenderingContext2D | null | undefined;

/** Any CSS color the browser can parse, as `#rrggbb`. `null` when it cannot
 *  parse it, so a caller can keep the value it already had.
 *
 *  `fillStyle` rejects an unparsable value by leaving the previous one in
 *  place, which is why it is seeded with a sentinel and checked. The read-back
 *  then does the color-space conversion: assigning `oklch(…)` and reading
 *  `fillStyle` gives the same `oklch(…)` string back, so the pixel is the only
 *  thing that actually answers in sRGB.
 *
 *  The ground is always opaque, so painting onto a cleared canvas needs no
 *  compositing care; an alpha would come back premultiplied. */
function toSrgbHex(color: string): string | null {
	if (!color) return null;
	if (ctx === undefined)
		ctx =
			document.createElement("canvas").getContext("2d", {
				willReadFrequently: true,
			}) ?? null;
	if (!ctx) return null;
	const SENTINEL = "#010203";
	ctx.fillStyle = SENTINEL;
	ctx.fillStyle = color;
	if (ctx.fillStyle === SENTINEL) return null;
	ctx.clearRect(0, 0, 1, 1);
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
	if (r === undefined || g === undefined || b === undefined) return null;
	return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** Keeps the meta on the ground for as long as the page lives. Returns the
 *  stop function, for a `useEffect` cleanup. */
export function startThemeColorSync(): () => void {
	const meta = document.head.querySelector<HTMLMetaElement>(SELECTOR);
	if (!meta) return () => {};

	const sync = () => {
		const ground = getComputedStyle(document.documentElement)
			.getPropertyValue("--ground")
			.trim();
		const hex = toSrgbHex(ground);
		// No stylesheet yet, or a value this browser cannot parse: the
		// before-paint guess is better than clearing the meta.
		if (!hex) return;
		if (meta.content !== hex) meta.content = hex;
	};

	// `data-theme` and `data-palette` are the two switches; `style` carries the
	// custom seed (`--seed-h` / `--seed-c`), which the wheel rewrites on every
	// drag frame. One computed read and one pixel per change is nothing.
	const observer = new MutationObserver(sync);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme", "data-palette", "style"],
	});
	// A stylesheet still loading when this runs: read again once it has.
	window.addEventListener("load", sync);
	sync();

	return () => {
		observer.disconnect();
		window.removeEventListener("load", sync);
	};
}
