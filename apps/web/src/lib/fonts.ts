import { useCallback, useSyncExternalStore } from "react";

// Preferences → Display → Font: which faces the app is set in, on this device.
//
// Three roles, because the app has three faces and they do different jobs:
//
//   body     `--sans`   everything that is read as text
//   display  `--serif`  page titles and the big numbers (`.h1`, `.h2`)
//   mono     `--mono`   durations and code, where figures have to line up
//
// Built the way `lib/theme.ts` builds light/dark, for the same reasons: the
// choice belongs to the device, it has to be applied before the first paint,
// and the DOM is the state.
//
// HOW A CHOICE REACHES THE UTILITIES. `styles.css` declares `--sans`, `--serif`
// and `--mono` as ordinary properties on `:root`, and `@theme inline` points
// Tailwind's `--font-sans` / `--font-display` / `--font-mono` at them. The
// `inline` is load-bearing: it inlines the *reference* into every generated
// utility, so `font-sans` compiles to `font-family: var(--sans)` and follows a
// runtime change. Written without it, Tailwind would bake the family name into
// the utility and no choice would ever reach a `font-sans` class.
//
// WHAT GETS DOWNLOADED. Nothing, until somebody picks a non-default face.
// The three defaults are in the static `@import` at the top of `styles.css`
// and are already on the page; anything else arrives as one injected <link>,
// built in the inline script so the face is requested before the first paint
// rather than after hydration.
//
// Only a face id is ever read out of localStorage, and only an id this
// catalogue knows is acted on. A family name or a CSS value read from storage
// and written into a style property would be a way to put arbitrary CSS on the
// page; an id checked against a table is not.

export type FaceRole = "body" | "display" | "mono";

type Face = {
	id: string;
	label: string;
	/** The CSS family name. Empty means "no named family": the role falls back
	 *  to the device's own stack and nothing is downloaded. */
	family: string;
	/** The `family=` segment of a Google Fonts css2 URL, axes and all. Empty
	 *  for the faces already in `styles.css`'s static import, and for System. */
	google: string;
	/** Corrections this face needs in the role, applied as custom properties —
	 *  see `CORRECTIONS` below. A display face carries a weight and a tracking;
	 *  a mono face carries a tracking. */
	a?: string;
	b?: string;
};

/** What a role falls back to when its face gives no family, and what sits at
 *  the end of every stack. */
const FALLBACK = {
	body: "ui-sans-serif, system-ui, sans-serif",
	display: "ui-serif, Georgia, serif",
	mono: "ui-monospace, monospace",
} satisfies Record<FaceRole, string>;

/** The roles, in the order the init script walks them. Written out rather than
 *  taken from `Object.keys`, which loses the type. */
const ROLE_ORDER: readonly FaceRole[] = ["body", "display", "mono"];

/** What one role writes: its own property, and the two correction properties
 *  beside it. An empty string is "this role has no such correction" — written
 *  out rather than left optional, so every read below is one string and not a
 *  narrowing. */
type RoleSpec = { property: string; a: string; b: string };

/** The property each role writes, and the two correction properties it may
 *  write with it. `styles.css` reads all of them with the default in the
 *  `var()` fallback, so an unwritten property is the default and there is no
 *  second place recording what the default was. */
const ROLES = {
	body: { property: "--sans", a: "", b: "" },
	display: {
		property: "--serif",
		a: "--display-weight",
		b: "--display-tracking",
	},
	mono: { property: "--mono", a: "--mono-tracking", b: "" },
} satisfies Record<FaceRole, RoleSpec>;

// The display rules in `styles.css` are set for Instrument Serif, which is
// drawn narrow and dark at 400. A face that is lighter, looser or larger at the
// same settings needs its own two numbers, which is what `a` and `b` are: the
// weight `.h1` and `.h2` take, and the tracking they give back. The mono faces
// carry a tracking only — `.mono`'s -0.03em is Geist Mono's, and a wider face
// at that setting runs its figures together.
const BODY_FACES: readonly Face[] = [
	{
		id: "instrument",
		label: "Instrument Sans",
		family: "Instrument Sans",
		google: "",
	},
	{
		id: "inter",
		label: "Inter",
		family: "Inter",
		google: "Inter:ital,wght@0,400;0,500;0,600;1,400",
	},
	{
		id: "geist",
		label: "Geist",
		family: "Geist",
		google: "Geist:wght@400;500;600",
	},
	{
		id: "figtree",
		label: "Figtree",
		family: "Figtree",
		google: "Figtree:ital,wght@0,400;0,500;0,600;1,400",
	},
	{
		id: "plex-sans",
		label: "IBM Plex Sans",
		family: "IBM Plex Sans",
		google: "IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400",
	},
	{
		id: "public-sans",
		label: "Public Sans",
		family: "Public Sans",
		google: "Public+Sans:ital,wght@0,400;0,500;0,600;1,400",
	},
	{
		id: "source-sans",
		label: "Source Sans 3",
		family: "Source Sans 3",
		google: "Source+Sans+3:ital,wght@0,400;0,500;0,600;1,400",
	},
	{
		id: "atkinson",
		label: "Atkinson Hyperlegible",
		family: "Atkinson Hyperlegible",
		google: "Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400",
	},
	{ id: "system", label: "System", family: "", google: "" },
];

const DISPLAY_FACES: readonly Face[] = [
	{
		id: "instrument",
		label: "Instrument Serif",
		family: "Instrument Serif",
		google: "",
	},
	{
		id: "fraunces",
		label: "Fraunces",
		family: "Fraunces",
		google: "Fraunces:opsz,wght@9..144,400..500",
		b: "0",
	},
	{
		id: "playfair",
		label: "Playfair Display",
		family: "Playfair Display",
		google: "Playfair+Display:wght@400;500",
		b: "0",
	},
	{
		id: "newsreader",
		label: "Newsreader",
		family: "Newsreader",
		google: "Newsreader:opsz,wght@6..72,400..500",
		b: "0",
	},
	{
		id: "spectral",
		label: "Spectral",
		family: "Spectral",
		google: "Spectral:wght@400;500",
		b: "0",
	},
	{
		id: "garamond",
		label: "EB Garamond",
		family: "EB Garamond",
		google: "EB+Garamond:wght@400;500",
		// Garamond is drawn small and light for its point size; a step of weight
		// is what keeps a page title reading as one.
		a: "500",
		b: "0.005em",
	},
	{
		id: "lora",
		label: "Lora",
		family: "Lora",
		google: "Lora:wght@400;500",
		b: "0",
	},
	{
		id: "libre-baskerville",
		label: "Libre Baskerville",
		family: "Libre Baskerville",
		google: "Libre+Baskerville:wght@400",
		// Runs wide and large. It takes the tracking back rather than adding it.
		b: "-0.015em",
	},
	{ id: "system", label: "System", family: "", google: "", b: "0" },
];

const MONO_FACES: readonly Face[] = [
	{ id: "geist-mono", label: "Geist Mono", family: "Geist Mono", google: "" },
	{
		id: "jetbrains",
		label: "JetBrains Mono",
		family: "JetBrains Mono",
		google: "JetBrains+Mono:wght@400;500",
		a: "-0.02em",
	},
	{
		id: "plex-mono",
		label: "IBM Plex Mono",
		family: "IBM Plex Mono",
		google: "IBM+Plex+Mono:wght@400;500",
		a: "-0.02em",
	},
	{
		id: "fira-code",
		label: "Fira Code",
		family: "Fira Code",
		google: "Fira+Code:wght@400;500",
		a: "-0.02em",
	},
	{
		id: "source-code",
		label: "Source Code Pro",
		family: "Source Code Pro",
		google: "Source+Code+Pro:wght@400;500",
		a: "-0.02em",
	},
	{
		id: "space-mono",
		label: "Space Mono",
		family: "Space Mono",
		google: "Space+Mono:wght@400;700",
		a: "-0.03em",
	},
	{ id: "system", label: "System", family: "", google: "", a: "0" },
];

export const FACES = {
	body: BODY_FACES,
	display: DISPLAY_FACES,
	mono: MONO_FACES,
} satisfies Record<FaceRole, readonly Face[]>;

/** The first entry of each list is what `styles.css` already sets, so choosing
 *  it stores nothing and writes nothing — the same rule the switches follow. */
const defaultId = (role: FaceRole) => FACES[role][0]?.id ?? "";

const storageKey = (role: FaceRole) => `farmer-font-${role}`;

/** The id of the <link> the chosen faces arrive through. One element, rebuilt
 *  whenever any role changes, rather than one per role: a second <link> for a
 *  face nobody uses any more would keep being fetched on every load. */
const LINK_ID = "farmer-fonts";

const BORING_KEY = "farmer-boring-font";

const CHANGE_EVENT = "farmer:fonts";

const faceOf = (role: FaceRole, id: string | null): Face | undefined =>
	FACES[role].find((f) => f.id === id);

const stackOf = (role: FaceRole, face: Face) =>
	face.family ? `'${face.family}', ${FALLBACK[role]}` : FALLBACK[role];

const GOOGLE_BASE = "https://fonts.googleapis.com/css2?family=";

/**
 * Runs in <head> before anything paints, as part of `displayInitScript` — see
 * `lib/display-prefs.ts`. The twin of `applyFaces` below; both exist for the
 * reason every before-paint setting in this app has a twin, which is that only
 * localStorage is readable that early and only a string can be put there.
 *
 * "Boring font" is read here and the display role skipped when it is on,
 * because that switch is a STYLESHEET rule (`:root[data-font='sans']`) and an
 * inline property beats any stylesheet rule whatever its selector. Writing the
 * chosen display face while the switch is on would let the display face win a
 * fight the switch is supposed to end.
 */
export const fontsInitScript = `(function(){try{
var C=${JSON.stringify(
	Object.fromEntries(
		ROLE_ORDER.map((role) => [
			role,
			Object.fromEntries(
				FACES[role].map((face) => [
					face.id,
					[stackOf(role, face), face.google, face.a ?? "", face.b ?? ""],
				]),
			),
		]),
	),
)};
var R=${JSON.stringify(
	ROLE_ORDER.map((role) => [
		role,
		storageKey(role),
		ROLES[role].property,
		ROLES[role].a,
		ROLES[role].b,
	]),
)};
var d=document.documentElement,L=[],boring=localStorage.getItem(${JSON.stringify(BORING_KEY)})==="1";
for(var i=0;i<R.length;i++){
var r=R[i];
if(r[0]==="display"&&boring)continue;
var e=C[r[0]][localStorage.getItem(r[1])];
if(!e)continue;
d.style.setProperty(r[2],e[0]);
if(e[1])L.push(e[1]);
if(r[3]&&e[2])d.style.setProperty(r[3],e[2]);
if(r[4]&&e[3])d.style.setProperty(r[4],e[3]);
}
if(L.length){var k=document.createElement("link");k.id=${JSON.stringify(LINK_ID)};k.rel="stylesheet";k.href=${JSON.stringify(GOOGLE_BASE)}+L.join("&family=")+"&display=swap";document.head.appendChild(k);}
}catch(e){}})();`;

const readStored = (role: FaceRole): string => {
	try {
		return localStorage.getItem(storageKey(role)) ?? defaultId(role);
	} catch {
		return defaultId(role);
	}
};

/** True when "Boring font" is on. Read from the DOM rather than from storage,
 *  so this and the stylesheet can never disagree. */
const boringFontOn = () =>
	document.documentElement.getAttribute("data-font") === "sans";

/**
 * Put every role's current face on <html>, and fetch whatever is missing.
 * Called on any change to a face AND whenever "Boring font" moves, since that
 * switch decides whether the display role writes anything at all.
 */
export const applyFaces = () => {
	const root = document.documentElement;
	const wanted: string[] = [];
	const boring = boringFontOn();

	for (const role of ROLE_ORDER) {
		const spec = ROLES[role];
		const face = faceOf(role, readStored(role));
		const skip = !face || face.id === defaultId(role);

		if (role === "display" && boring) {
			// The switch owns `--serif` and both corrections while it is on.
			root.style.removeProperty(spec.property);
			if (spec.a) root.style.removeProperty(spec.a);
			if (spec.b) root.style.removeProperty(spec.b);
			continue;
		}

		if (skip) {
			root.style.removeProperty(spec.property);
			if (spec.a) root.style.removeProperty(spec.a);
			if (spec.b) root.style.removeProperty(spec.b);
			continue;
		}

		root.style.setProperty(spec.property, stackOf(role, face));
		if (face.google) wanted.push(face.google);
		if (spec.a) {
			if (face.a) root.style.setProperty(spec.a, face.a);
			else root.style.removeProperty(spec.a);
		}
		if (spec.b) {
			if (face.b) root.style.setProperty(spec.b, face.b);
			else root.style.removeProperty(spec.b);
		}
	}

	// A face the person has moved away from stays in the document — a browser
	// cannot unload a face, and removing the rule would only make the old text
	// reflow twice. The href is rebuilt from what is wanted NOW, so the next
	// cold load asks for nothing extra.
	const existing = document.getElementById(LINK_ID);
	if (!wanted.length) {
		existing?.remove();
		return;
	}
	const href = `${GOOGLE_BASE}${wanted.join("&family=")}&display=swap`;
	if (existing instanceof HTMLLinkElement) {
		if (existing.href !== href) existing.href = href;
		return;
	}
	const link = document.createElement("link");
	link.id = LINK_ID;
	link.rel = "stylesheet";
	link.href = href;
	document.head.appendChild(link);
};

/** How long a pick waits for its face before it is applied anyway. Past this
 *  the network is the problem, and `display=swap` draws the fallback until the
 *  face turns up — which is what every pick did before this wait existed. */
const PRELOAD_TIMEOUT_MS = 8000;

/**
 * Fetch a face that is not on the page yet, before any role points at it.
 *
 * Pointed at first, the role drew the device's fallback until the file came
 * in and then swapped again — two changes for one pick, the first of them
 * away from what was asked for. So the face's own stylesheet goes in first,
 * the file is loaded through it, and only then is the role moved.
 *
 * The <link> stays. `applyFaces` builds the one link a cold load reads, and
 * its stylesheet is a second fetch: removing this one before that one has
 * parsed would leave a frame with no rule for the face. A face nobody uses
 * any more costs nothing — a browser cannot unload one anyway.
 */
const preloadFace = async (role: FaceRole, face: Face) => {
	if (!face.google || !face.family) return;
	const id = `${LINK_ID}-${role}-${face.id}`;
	if (!document.getElementById(id)) {
		const link = document.createElement("link");
		link.id = id;
		link.rel = "stylesheet";
		link.href = `${GOOGLE_BASE}${face.google}&display=swap`;
		const parsed = new Promise((resolve) => {
			link.addEventListener("load", resolve, { once: true });
			link.addEventListener("error", resolve, { once: true });
		});
		document.head.appendChild(link);
		await parsed;
	}
	await document.fonts.load(`1em '${face.family}'`);
};

/** Store a pick, show it in the selector at once, and apply it once its face
 *  is here. Resolves when the pick is drawn, for the selector's "Loading". */
export const setFace = async (role: FaceRole, id: string) => {
	try {
		if (id === defaultId(role)) localStorage.removeItem(storageKey(role));
		else localStorage.setItem(storageKey(role), id);
	} catch {
		// Private-mode / blocked storage. `applyFaces` reads storage back, so
		// this one is genuinely lost rather than merely unremembered — there is
		// nowhere else to keep it that the inline script could reach.
	}
	// The selector follows storage, so it shows the pick before the fetch.
	window.dispatchEvent(new Event(CHANGE_EVENT));
	const face = faceOf(role, id);
	if (face) {
		await Promise.race([
			preloadFace(role, face).catch(() => {}),
			new Promise((resolve) => setTimeout(resolve, PRELOAD_TIMEOUT_MS)),
		]);
	}
	applyFaces();
	window.dispatchEvent(new Event(CHANGE_EVENT));
};

if (!import.meta.env.SSR) {
	// Another tab's choice. Listened for here rather than in `subscribe`: that
	// runs only where the selector is on screen, and every open tab has to
	// follow whatever page it is showing.
	window.addEventListener("storage", (event) => {
		if (!event.key?.startsWith("farmer-font-")) return;
		applyFaces();
		window.dispatchEvent(new Event(CHANGE_EVENT));
	});
}

const subscribe = (onChange: () => void) => {
	window.addEventListener(CHANGE_EVENT, onChange);
	return () => window.removeEventListener(CHANGE_EVENT, onChange);
};

/** The face chosen for one role on this device, and the way to change it.
 *  Server-renders as the default and corrects itself on hydration, which only
 *  ever moves the selected option. */
export function useFace(role: FaceRole) {
	const id = useSyncExternalStore(
		subscribe,
		() => readStored(role),
		() => defaultId(role),
	);
	const set = useCallback((next: string) => setFace(role, next), [role]);
	return [id, set] as const;
}
