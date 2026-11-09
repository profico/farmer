// The browser chrome's color: the status bar of the installed PWA, the tab
// strip on a phone browser, the title bar on a desktop one.
//
// It is `--ground`, the surface the islands stand on, so the chrome reads as
// part of the page.
//
// A static `<meta name="theme-color">` cannot say this. Light and dark hold
// different literals, Custom (Preferences → Display → Colors) derives the
// ground from a seed, and `media=` follows the OS, not the stored choice. So
// script writes the value in two steps:
//
//   1. `themeColorInitScript`, inline in <head> after the theme script: the
//      vanilla ground of the theme in `data-theme`. It runs before the
//      stylesheet exists, so it is exact for vanilla and the nearest grey for
//      Custom. The chrome is right at first paint.
//   2. `startThemeColorSync`, once React is up: it reads `--ground` off <html>
//      again whenever `data-theme`, `data-palette` or the seed changes.
//
// The value must be sRGB, written as `#rrggbb`. Under a custom palette
// `--ground` computes to an `oklch()` expression. A platform that cannot parse
// the meta content ignores the meta and uses the web manifest's `theme_color`,
// which is cached at install time (Android showed the old violet). `toSrgbHex`
// resolves any parseable color to three bytes through a 1x1 canvas.
//
// The source is `--ground`, not the body's computed background. The body
// resolves to `--bg`, one step lighter, so the chrome would not match the
// strip under it.
//
// The two literals below copy `--ground` in `styles.css`. Keep them in step,
// or a cold load shows one frame of the old color.

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
