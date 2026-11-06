import Constants from "expo-constants";
import { Platform } from "react-native";

import { defaultServerFrom } from "./session/server-address";

/** The app's version, from the app config. The server's `minMobileVersion`
 *  is compared with it. */
export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";

/** `farmer-mobile/0.1.0 (android 35)`, so the server's logs and its list of
 *  signed-in devices can tell the app from the CLI. */
export const USER_AGENT = `farmer-mobile/${APP_VERSION} (${Platform.OS} ${String(Platform.Version)})`;

/** Where the person gets a newer app, for the "update the app" error.
 *  shortcut: iOS opens TestFlight, because the app has no App Store listing
 *  yet. Use `itms-apps://apps.apple.com/app/id<id>` once it has one. */
export const STORE_URL =
	Platform.OS === "ios"
		? "itms-beta://"
		: `https://play.google.com/store/apps/details?id=${Constants.expoConfig?.android?.package ?? "com.profico.farmer"}`;

/** The server that an internal build starts with, or null. The Server screen
 *  fills its field with it when the app has no saved server. */
export const DEFAULT_SERVER = defaultServerFrom(Constants.expoConfig?.extra);
