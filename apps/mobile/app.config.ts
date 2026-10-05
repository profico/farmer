import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { ExpoConfig } from "expo/config";
import {
	AndroidConfig,
	type ConfigPlugin,
	withAndroidColors,
	withAndroidColorsNight,
	withDangerousMod,
} from "expo/config-plugins";

// The window behind every screen, before the app draws and during a screen
// transition, and the background of the splash: the ground of the farmer
// palette (`src/ui/farmer-theme.ts`, the web's `--ground`). At runtime the
// app sets the exact colour of the theme in force (`app/_layout.tsx`).
const BACKGROUND_LIGHT = "#efece5";
const BACKGROUND_DARK = "#0e0d0a";

/** The violet of the mark. */
const BRAND = "#6F4EBE";

/**
 * The small icon of a notification in the Android status bar, as
 * `@drawable/notification_icon`, and its colour as
 * `@color/notification_icon_color`. These are the names that the
 * `expo-notifications` plugin writes, so that plugin can take over with the
 * same files (`assets/notification-icon.png`).
 */
const withNotificationIcon: ConfigPlugin = (config) =>
	withAndroidColors(
		withDangerousMod(config, [
			"android",
			async (modConfig) => {
				const { projectRoot, platformProjectRoot } = modConfig.modRequest;
				for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
					const folder = join(
						platformProjectRoot,
						"app/src/main/res",
						`drawable-${density}`,
					);
					await mkdir(folder, { recursive: true });
					await copyFile(
						join(projectRoot, "assets/notification-icon", `${density}.png`),
						join(folder, "notification_icon.png"),
					);
				}
				return modConfig;
			},
		]),
		(colors) => {
			colors.modResults = AndroidConfig.Colors.assignColorValue(
				colors.modResults,
				{ name: "notification_icon_color", value: BRAND },
			);
			return colors;
		},
	);

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
	// `scripts/make-icons.ts` draws every image in `assets/` from the mark.
	icon: "./assets/icon.png",
	ios: {
		bundleIdentifier: "com.profico.farmer",
		// ADR 0005: iOS 18 or later.
		deploymentTarget: "18.0",
		supportsTablet: true,
	},
	android: {
		package: "com.profico.farmer",
		backgroundColor: BACKGROUND_LIGHT,
		adaptiveIcon: {
			foregroundImage: "./assets/adaptive-icon.png",
			backgroundImage: "./assets/adaptive-icon-background.png",
			// Android 13 themed icons.
			monochromeImage: "./assets/adaptive-icon-monochrome.png",
			backgroundColor: BRAND,
		},
	},
	plugins: [
		"expo-router",
		"expo-system-ui",
		"expo-secure-store",
		"expo-web-browser",
		[
			"expo-splash-screen",
			{
				// The mark on the ground of the farmer palette. 128 dp keeps the
				// whole tile inside the circle that Android 12 and later cut
				// the splash icon to.
				image: "./assets/splash-icon.png",
				imageWidth: 128,
				resizeMode: "contain",
				backgroundColor: BACKGROUND_LIGHT,
				dark: {
					image: "./assets/splash-icon.png",
					backgroundColor: BACKGROUND_DARK,
				},
			},
		],
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

export default withNotificationIcon(withDarkWindowBackground(config));
