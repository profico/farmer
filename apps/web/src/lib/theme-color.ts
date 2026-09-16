// The browser chrome's color: the status bar of the installed PWA, the tab
// strip on a phone browser, the title bar on a desktop one.
//
// It is the ground — `--ground`, what `body` is painted with and what shows
// through around every island — so the chrome reads as part of the page it
// sits above. It used to be the logo violet, which drew a purple band across
// the top of every screen, in both palettes, above content that has no violet
// surface anywhere in it.
//
// A static `<meta name="theme-color">` cannot say this, because the ground is
// not one color: light and dark hold different literals, and Custom
// (Preferences → Display → Colors) derives it from a seed in CSS. `media=`
// on the meta follows the OS, not the stored choice. So the value is written
// by script, in two steps:
//
//   1. `themeColorInitScript`, inline in <head> after the theme script: the
//      vanilla ground of whichever theme `data-theme` holds. A guess, made
//      before the stylesheet exists — for vanilla it is exact, for Custom it
//      is the nearest grey — so the chrome is right at first paint rather
//      than violet for a frame.
//   2. `startThemeColorSync`, once React is up: the body's COMPUTED background,
//      re-read whenever `data-theme`, `data-palette` or the seed on <html>
//      changes. That covers Custom, the wheel being dragged, and another tab's
//      switch, without this module knowing how any palette is built.
//
// The two literals are copies of `--ground` in `styles.css`. Keep them in
// step: a drift shows as a one-frame band of the old color on a cold load.

const VANILLA_GROUND = { light: "#efece5", dark: "#0e0d0a" } as const;

const SELECTOR = 'meta[name="theme-color"]';

/** Runs in <head> before anything paints — see `__root.tsx`. Must follow
 *  `themeInitScript`, which is what puts `data-theme` on <html>. */
export const themeColorInitScript = `(function(){try{var m=document.createElement("meta");m.name="theme-color";m.content=document.documentElement.getAttribute("data-theme")==="dark"?${JSON.stringify(VANILLA_GROUND.dark)}:${JSON.stringify(VANILLA_GROUND.light)};document.head.appendChild(m);}catch(e){}})();`;

/** Keeps the meta on the body's computed background for as long as the page
 *  lives. Returns the stop function, for a `useEffect` cleanup. */
export function startThemeColorSync(): () => void {
	const meta = document.head.querySelector<HTMLMetaElement>(SELECTOR);
	if (!meta) return () => {};

	const sync = () => {
		const color = getComputedStyle(document.body).backgroundColor;
		// `transparent` is what a body with no stylesheet yet answers; the
		// before-paint guess is better than that.
		if (!color || color === "rgba(0, 0, 0, 0)" || color === "transparent")
			return;
		if (meta.content !== color) meta.content = color;
	};

	// `data-theme` and `data-palette` are the two switches; `style` carries the
	// custom seed (`--seed-h` / `--seed-c`), which the wheel rewrites on every
	// drag frame. One read of one computed value per change is nothing.
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
