import { useSyncExternalStore } from "react";
import {
	DEFAULT_PREFERENCES,
	loadPreferences,
	subscribePreferences,
} from "#/lib/preferences.ts";

export const usePreferences = () =>
	useSyncExternalStore(
		subscribePreferences,
		loadPreferences,
		() => DEFAULT_PREFERENCES,
	);
