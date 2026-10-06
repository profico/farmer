import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";
import { Appearance } from "react-native";
import { z } from "zod";

import { NightMode } from "../../modules/night-mode";
import { THEME_IDS } from "./farmer-theme";

// More, "Display": how the app looks on this phone. The choices belong to the
// device, as on the web (`apps/web/src/lib/display-prefs.ts`), so they live in
// a small key-value store on the phone and never go to the Server.
//
// The store is read synchronously when this module loads, before the first
// screen draws, so a cold start never shows the default theme first and then
// the chosen one.

const SchemePref = z.enum(["system", "light", "dark"]);
export type SchemePref = z.infer<typeof SchemePref>;

const DisplayPrefs = z.object({
	/** Light, dark, or the phone's setting. */
	scheme: SchemePref.catch("system"),
	/** The theme colour: the farmer palette or one of the web's seeds. */
	theme: z.enum(THEME_IDS).catch("farmer"),
	/** Android 12 and later: the colours of the wallpaper. When off, or on a
	 *  phone without them, `theme` applies. */
	materialYou: z.boolean().catch(true),
	/** The web's "High contrast": the ink is drawn harder on the same paper. */
	highContrast: z.boolean().catch(false),
	/** The web's "Less motion". The phone's own reduce-motion setting has the
	 *  same effect; see `useMotionPreference`. */
	lessMotion: z.boolean().catch(false),
});

export type DisplayPrefs = z.infer<typeof DisplayPrefs>;

const STORAGE_KEY = "farmer-display";

const DEFAULTS: DisplayPrefs = DisplayPrefs.parse({});

const read = (): DisplayPrefs => {
	try {
		const stored = Storage.getItemSync(STORAGE_KEY);
		return stored ? DisplayPrefs.parse(JSON.parse(stored)) : DEFAULTS;
	} catch {
		// A store that cannot be read, or a value from a later version of the
		// app: the defaults are a complete theme.
		return DEFAULTS;
	}
};

/** The phone's light or dark mode, set for the whole app. The native
 *  controls, the system colours and `useColorScheme` all follow it. On
 *  Android a copy goes to the native side, which sets it before the next
 *  start of the activity (`modules/night-mode`). Without the copy, a cold
 *  start showed the native dialogs in the phone's mode. */
const applyScheme = (scheme: SchemePref) => {
	NightMode?.save(scheme);
	Appearance.setColorScheme(scheme === "system" ? "unspecified" : scheme);
};

let current = read();
applyScheme(current.scheme);

/**
 * Applies the chosen scheme again. Call it when the app draws its root.
 * On Android, `expo-system-ui` sets the night mode of the config ("automatic")
 * each time the activity starts. After the back button closes the app, the
 * JavaScript stays loaded and this module does not run again, so the native
 * dialogs then followed the phone and not the choice.
 */
export const reapplyScheme = () => applyScheme(current.scheme);

const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/** Changes one display preference. The change applies at once and is then
 *  written to the phone. */
export const setDisplayPref = <K extends keyof DisplayPrefs>(
	key: K,
	value: DisplayPrefs[K],
) => {
	current = { ...current, [key]: value };
	if (key === "scheme") applyScheme(current.scheme);
	for (const listener of listeners) listener();
	Storage.setItemAsync(STORAGE_KEY, JSON.stringify(current)).catch(() => {
		// The choice still applies until the app closes; it is only not kept.
	});
};

/** The display preferences of this phone. A change re-renders every reader. */
export const useDisplayPrefs = (): DisplayPrefs =>
	useSyncExternalStore(subscribe, () => current);
