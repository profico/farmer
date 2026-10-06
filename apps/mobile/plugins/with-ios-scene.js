// The iOS UIScene life cycle. The iOS 27 SDK refuses to launch an app
// without it ("UIScene life cycle is required for apps built with this
// SDK"). The Expo SDK 57 template still has the old AppDelegate, so this
// plugin changes two things in the iOS project:
//
// - Info.plist gets a `UIApplicationSceneManifest` whose one window scene
//   uses `EXExpoAppSceneDelegate`, the scene delegate of the `expo` package.
//   That delegate makes the window and starts React Native.
// - `AppDelegate.swift` conforms to `ExpoReactNativeFactoryProvider` and no
//   longer makes the window or starts React Native. It only makes the
//   factory in `didFinishLaunching`.
//
// The patch to `AppDelegate.swift` throws when the template text is not
// what it expects. Remove this plugin when the Expo template has the scene
// life cycle.

const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const SCENE_DELEGATE = "EXExpoAppSceneDelegate";

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withSceneManifest = (config) =>
	withInfoPlist(config, (mod) => {
		mod.modResults.UIApplicationSceneManifest = {
			UIApplicationSupportsMultipleScenes: false,
			UISceneConfigurations: {
				UIWindowSceneSessionRoleApplication: [
					{
						UISceneConfigurationName: "Default Configuration",
						UISceneDelegateClassName: SCENE_DELEGATE,
					},
				],
			},
		};
		return mod;
	});

const CLASS_BEFORE = "class AppDelegate: ExpoAppDelegate {";
const CLASS_AFTER =
	"class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {";

// The window and the React Native start of the old template.
const WINDOW_BLOCK =
	/#if os\(iOS\) \|\| os\(tvOS\)\s*\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*\n\s*factory\.startReactNative\(\s*withModuleName: "main",\s*in: window,\s*launchOptions: launchOptions\)\s*\n#endif\s*\n/;

/**
 * @param {string} source
 * @returns {string}
 */
function patchAppDelegate(source) {
	if (source.includes("ExpoReactNativeFactoryProvider")) return source;
	if (!source.includes(CLASS_BEFORE)) {
		throw new Error(
			`with-ios-scene: AppDelegate.swift has no "${CLASS_BEFORE}". The Expo template changed; update plugins/with-ios-scene.js.`,
		);
	}
	if (!WINDOW_BLOCK.test(source)) {
		throw new Error(
			"with-ios-scene: AppDelegate.swift has no window and startReactNative block in the expected form. The Expo template changed; update plugins/with-ios-scene.js.",
		);
	}
	return source
		.replace(CLASS_BEFORE, CLASS_AFTER)
		.replace(
			WINDOW_BLOCK,
			"// The scene delegate makes the window and starts React Native.\n",
		);
}

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withSceneAppDelegate = (config) =>
	withAppDelegate(config, (mod) => {
		if (mod.modResults.language !== "swift") {
			throw new Error("with-ios-scene: AppDelegate is not Swift.");
		}
		mod.modResults.contents = patchAppDelegate(mod.modResults.contents);
		return mod;
	});

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withIosScene = (config) =>
	withSceneAppDelegate(withSceneManifest(config));

module.exports = withIosScene;
module.exports.patchAppDelegate = patchAppDelegate;
