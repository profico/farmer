/**
 * The Preferences → Display switches of the app that the site follows: "High
 * contrast", "Boring font" and "Less movement". The app stores each one in
 * localStorage on this origin, and the site shares the origin, so a reader's
 * choice carries over. Each switch is one attribute on <html>, and
 * `styles.css` does the rest from the attribute.
 *
 * Inline in <head> before paint, like `themeInitScript`. The keys and the
 * attributes are copies of the app's (`apps/web/src/lib/display-prefs.ts`).
 */
const PREFS = [
	{ key: "farmer-boring-font", attribute: "data-font", value: "sans" },
	{ key: "farmer-less-motion", attribute: "data-motion", value: "reduce" },
	{ key: "farmer-high-contrast", attribute: "data-contrast", value: "high" },
] as const;

export const displayInitScript = `(function(){try{var p=${JSON.stringify(PREFS)};for(var i=0;i<p.length;i++){if(localStorage.getItem(p[i].key)==="1")document.documentElement.setAttribute(p[i].attribute,p[i].value);}}catch(e){}})();`;
