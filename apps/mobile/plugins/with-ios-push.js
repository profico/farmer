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
// WRITTEN, NOT COMPILED: the Swift sources were written on Linux, where Xcode
// does not run. Build the iOS app on a Mac before a release.

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
const withIosPush = (config) =>
	withPlugins(config, [
		withAppGroup,
		withLiveActivities,
		[
			"@bacons/apple-targets",
			{
				root: "./plugins/ios-targets",
				appleTeamId: process.env.APPLE_TEAM_ID ?? config.ios?.appleTeamId,
			},
		],
	]);

module.exports = withIosPush;
module.exports.APP_GROUP = APP_GROUP;
