// The widget extension that draws the timer's Live Activity. iOS only:
// `@bacons/apple-targets` reads this file when it builds the Xcode project.
// WRITTEN, NOT COMPILED.

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
	type: "widget",
	name: "TimerWidget",
	bundleIdentifier: ".timer-widget",
	deploymentTarget: "18.0",
	frameworks: ["SwiftUI", "WidgetKit", "ActivityKit", "AppIntents"],
	entitlements: {
		"com.apple.security.application-groups": ["group.com.profico.farmer"],
	},
});
