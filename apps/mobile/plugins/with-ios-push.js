// The iOS half of native push. Every change here is in the iOS project; the
// Android project is the same with or without this plugin.
//
// - The app group `group.com.profico.farmer`, for the app and both
//   extensions. It is also the Keychain access group of the device key and of
//   the credential copy (`src/push/storage.ts`).
// - `NSSupportsLiveActivities`, for the timer's Live Activity.
// - Two extension targets from `plugins/ios-targets/`, which
//   `@bacons/apple-targets` adds: the Notification Service Extension that
//   opens an alert, and the widget that draws the Live Activity.
//
// BUILT ON A MAC, NOT RUN ON A DEVICE: the iOS app built on a Mac on
// 6 Oct 2026. Run the app, the extension and the widget on a device before a
// release.

const {
	withEntitlementsPlist,
	withInfoPlist,
	withPlugins,
} = require("expo/config-plugins");

const APP_GROUP = "group.com.profico.farmer";

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withAppGroup = (config) =>
	withEntitlementsPlist(config, (mod) => {
		const key = "com.apple.security.application-groups";
		const groups = mod.modResults[key];
		const list = Array.isArray(groups) ? groups.map(String) : [];
		if (!list.includes(APP_GROUP)) list.push(APP_GROUP);
		mod.modResults[key] = list;
		return mod;
	});

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withLiveActivities = (config) =>
	withInfoPlist(config, (mod) => {
		mod.modResults.NSSupportsLiveActivities = true;
		return mod;
	});

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withIosPush = (config) => {
	const appleTeamId = process.env.APPLE_TEAM_ID ?? config.ios?.appleTeamId;
	if (!appleTeamId) {
		// A build for a device or for release cannot sign the extensions
		// without a team. A build for the simulator does not need one.
		console.warn(
			"[with-ios-push] Neither APPLE_TEAM_ID nor ios.appleTeamId is set. The iOS extensions have no signing team.",
		);
	}
	return withPlugins(config, [
		withAppGroup,
		withLiveActivities,
		[
			"@bacons/apple-targets",
			{
				root: "./plugins/ios-targets",
				appleTeamId,
			},
		],
	]);
};

module.exports = withIosPush;
module.exports.APP_GROUP = APP_GROUP;
