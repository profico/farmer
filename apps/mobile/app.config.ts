import type { ExpoConfig } from "expo/config";
import {
	AndroidConfig,
	type ConfigPlugin,
	withAndroidColorsNight,
} from "expo/config-plugins";

import { withPush } from "./plugins/with-push.js";

// The window behind every screen, before the app draws and during a screen
// transition: the background of the Material 3 baseline (`src/ui/theme.ts`).
// At runtime the app sets the exact colour of the theme (`app/_layout.tsx`).
const BACKGROUND_LIGHT = "#fef7ff";
const BACKGROUND_DARK = "#141218";

/**
 * `expo-system-ui` writes one window colour (`activityBackground`). This adds
 * the dark one in `values-night`, so a phone in dark mode never shows a light
 * frame behind a screen as it slides in.
 */
const withDarkWindowBackground: ConfigPlugin = (config) =>
	withAndroidColorsNight(config, (night) => {
		night.modResults = AndroidConfig.Colors.assignColorValue(night.modResults, {
			name: "activityBackground",
			value: BACKGROUND_DARK,
		});
		return night;
	});

// The app is one client for every Server (ADR 0005), so nothing here names a
// server. The person gives the Server address on the first screen.
const config: ExpoConfig = {
	name: "Farmer",
	slug: "farmer",
	version: "0.1.0",
	scheme: "farmer",
	orientation: "portrait",
	userInterfaceStyle: "automatic",
	backgroundColor: BACKGROUND_LIGHT,
	ios: {
		bundleIdentifier: "com.profico.farmer",
		// ADR 0005: iOS 18 or later.
		deploymentTarget: "18.0",
		supportsTablet: true,
	},
	android: {
		package: "com.profico.farmer",
		backgroundColor: BACKGROUND_LIGHT,
	},
	plugins: [
		"expo-router",
		"expo-system-ui",
		"expo-secure-store",
		"expo-web-browser",
		[
			"expo-build-properties",
			{
				android: {
					// Two ABIs: real phones and the x86_64 emulator. The other two
					// double the build time for devices nobody tests on.
					buildArchs: ["arm64-v8a", "x86_64"],
					// ADR 0005: Android 10 (API 29) or later.
					minSdkVersion: 29,
					// Lets a LAN or emulator test Server on plain http work, for
					// example http://10.0.2.2:3000. Revisit before a store release.
					usesCleartextTraffic: true,
				},
			},
		],
	],
	experiments: {
		typedRoutes: false,
	},
};

export default withPush(withDarkWindowBackground(config));
