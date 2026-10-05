import type { ExpoConfig } from "expo/config";

// The app is one client for every Server (ADR 0005), so nothing here names a
// server. The person gives the Server address on the first screen.
const config: ExpoConfig = {
	name: "Farmer",
	slug: "farmer",
	version: "0.1.0",
	scheme: "farmer",
	orientation: "portrait",
	userInterfaceStyle: "automatic",
	ios: {
		bundleIdentifier: "com.profico.farmer",
		// ADR 0005: iOS 18 or later.
		deploymentTarget: "18.0",
		supportsTablet: true,
	},
	android: {
		package: "com.profico.farmer",
	},
	plugins: [
		"expo-router",
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

export default config;
