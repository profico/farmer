// The release signing of the Android build, read from the environment.
//
// The prebuilt `android/` project signs the release build with the debug
// keystore. A release build on CI needs the release keystore, and the
// keystore must not be in the repository. This plugin adds a `release`
// signing config to `app/build.gradle`, and the release build type uses it
// when `FARMER_KEYSTORE_PATH` is set:
//
// - `FARMER_KEYSTORE_PATH`: the path of the keystore file (absolute).
// - `FARMER_KEYSTORE_PASSWORD`: the password of the keystore.
// - `FARMER_KEY_ALIAS`: the alias of the key.
// - `FARMER_KEY_PASSWORD`: the password of the key.
//
// Without `FARMER_KEYSTORE_PATH` the build is the same as before: it signs
// with the debug keystore, so a local build keeps working.
//
// The patch throws when the template text is not what it expects, so a
// change of the Expo template does not give an unsigned or debug-signed
// release without a warning.
//
// This file is CommonJS, like the other plugins that `app.config.ts` loads.

const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "FARMER_KEYSTORE_PATH";

const SIGNING_ANCHOR = "    signingConfigs {\n";
const RELEASE_SIGNING = `${SIGNING_ANCHOR}        release {
            def farmerKeystore = System.getenv("FARMER_KEYSTORE_PATH")
            if (farmerKeystore) {
                storeFile file(farmerKeystore)
                storePassword System.getenv("FARMER_KEYSTORE_PASSWORD")
                keyAlias System.getenv("FARMER_KEY_ALIAS")
                keyPassword System.getenv("FARMER_KEY_PASSWORD")
            }
        }
`;

// The `signingConfig` line of the release build type, after its comment.
const RELEASE_BUILD_TYPE =
	/(release \{\s*\n(?:\s*\/\/[^\n]*\n)*\s*)signingConfig signingConfigs\.debug/;

/**
 * @param {string} source
 * @returns {string}
 */
function patchBuildGradle(source) {
	if (source.includes(MARKER)) return source;
	if (!source.includes(SIGNING_ANCHOR)) {
		throw new Error(
			"with-android-signing: app/build.gradle has no signingConfigs block. The Expo template changed; update plugins/with-android-signing.js.",
		);
	}
	if (!RELEASE_BUILD_TYPE.test(source)) {
		throw new Error(
			"with-android-signing: the release build type has no debug signingConfig. The Expo template changed; update plugins/with-android-signing.js.",
		);
	}
	return source
		.replace(SIGNING_ANCHOR, RELEASE_SIGNING)
		.replace(
			RELEASE_BUILD_TYPE,
			`$1signingConfig System.getenv("${MARKER}") ? signingConfigs.release : signingConfigs.debug`,
		);
}

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withAndroidSigning = (config) =>
	withAppBuildGradle(config, (mod) => {
		if (mod.modResults.language !== "groovy") {
			throw new Error("with-android-signing: app/build.gradle is not Groovy.");
		}
		mod.modResults.contents = patchBuildGradle(mod.modResults.contents);
		return mod;
	});

module.exports = { withAndroidSigning, patchBuildGradle };
