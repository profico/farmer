// Native push for the app (ADR 0006, `docs/domains/mobile.md`).
//
// - `expo-notifications`: the FCM service on Android, the `aps-environment`
//   entitlement on iOS.
// - Android: `google-services.json`, only when it exists. Without it the APK
//   still builds and starts; the app gets no push token and logs that one
//   time. Give its path in `GOOGLE_SERVICES_JSON`, or put the file next to
//   `app.config.ts`.
// - iOS: the app group, the Live Activity and the Notification Service
//   Extension (`with-ios-push.js`). That part changes only the iOS project.
//
// The ongoing timer notification on Android is a local module
// (`modules/timer-notification`). Autolinking adds it with its receiver, so
// this plugin makes no change to the Android manifest.
//
// This file is CommonJS: the loader of `app.config.ts` transpiles only that
// file, and a TypeScript file that it requires does not load.

const { existsSync } = require("node:fs");
const { join } = require("node:path");

// `production` for a store or TestFlight build, `sandbox` for a build that
// Xcode signs for development. The entitlement and the relay registration
// read the same value.
const apnsEnvironment =
	process.env.APNS_ENVIRONMENT === "sandbox" ? "sandbox" : "production";

// The brand's notification icon, when the brand assets have one: a white
// shape on transparency. Without it the timer notification uses the
// stopwatch of `modules/timer-notification`.
const NOTIFICATION_ICONS = [
	"./assets/notification-icon.png",
	"./assets/images/notification-icon.png",
];

/**
 * Adds the push settings and plugins to the app config. `app.config.ts`
 * calls it at load time, before Expo resolves any plugin, so the plugins go
 * into `config.plugins` and Expo runs them in order after the others.
 *
 * @param {import("expo/config").ExpoConfig} config
 * @returns {import("expo/config").ExpoConfig}
 */
const withPush = (config) => {
	const projectRoot = join(__dirname, "..");
	const icon = NOTIFICATION_ICONS.find((path) =>
		existsSync(join(projectRoot, path)),
	);
	const googleServices =
		process.env.GOOGLE_SERVICES_JSON ??
		(existsSync(join(projectRoot, "google-services.json"))
			? "./google-services.json"
			: undefined);

	const android = { ...config.android };
	if (googleServices) android.googleServicesFile = googleServices;

	return {
		...config,
		android,
		extra: { ...config.extra, apnsEnvironment },
		plugins: [
			...(config.plugins ?? []),
			[
				"expo-notifications",
				{
					icon,
					color: "#6f4ebe",
					defaultChannel: "reminders",
					mode: apnsEnvironment === "sandbox" ? "development" : "production",
				},
			],
			"./plugins/with-ios-push.js",
		],
	};
};

module.exports = { withPush };
