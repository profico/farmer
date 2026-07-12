// Client-only, per-browser preferences — never synced to the server. Add new
// fields to `Preferences`/`DEFAULT_PREFERENCES` as more settings show up.
export type PageTransition = "none" | "fade" | "slide" | "zoom";

// How lively motion is across the app — one dial that scales both the JS
// springs (tab pill, panel crossfades) and the CSS view-transition page
// changes. Ordered slowest-off → most theatrical; see lib/animation.ts.
export type AnimationSpeed = "instant" | "nicer" | "eyecandy" | "whoa";
export const ANIMATION_SPEEDS: AnimationSpeed[] = [
	"instant",
	"nicer",
	"eyecandy",
	"whoa",
];

export type Preferences = {
	pageTransition: PageTransition;
	animationSpeed: AnimationSpeed;
};

export const DEFAULT_PREFERENCES: Preferences = {
	pageTransition: "none",
	animationSpeed: "instant",
};

const STORAGE_KEY = "farmer:preferences";

const readFromStorage = (): Preferences => {
	if (typeof window === "undefined") return DEFAULT_PREFERENCES;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_PREFERENCES;
		return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
	} catch {
		return DEFAULT_PREFERENCES;
	}
};

// useSyncExternalStore requires getSnapshot to return a stable reference when
// nothing has changed (React compares with Object.is) — cache it rather than
// re-parsing localStorage into a fresh object on every call, which would look
// like a change on every render and infinite-loop.
let cached = readFromStorage();
const listeners = new Set<() => void>();

export const loadPreferences = (): Preferences => cached;

export const savePreferences = (patch: Partial<Preferences>): void => {
	cached = { ...cached, ...patch };
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
	for (const listener of listeners) listener();
};

export const subscribePreferences = (listener: () => void): (() => void) => {
	listeners.add(listener);
	// Cross-tab: another tab writing localStorage fires `storage` here, not there.
	const onStorage = (e: StorageEvent) => {
		if (e.key !== STORAGE_KEY) return;
		cached = readFromStorage();
		listener();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
};
