// The Notification Service Extension: it opens the sealed text of an alert
// with the device key before iOS shows it. iOS only. WRITTEN, NOT COMPILED.

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
	type: "notification-service",
	name: "NotificationService",
	bundleIdentifier: ".notification-service",
	deploymentTarget: "18.0",
	frameworks: ["CryptoKit"],
	entitlements: {
		"com.apple.security.application-groups": ["group.com.profico.farmer"],
	},
});
