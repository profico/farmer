import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";
import { Platform } from "react-native";

import { deleteAllPushItems, migratePushItems } from "../push/storage";
import { migrateSession, SESSION_KEY } from "./storage";

/**
 * iOS keeps Keychain items after the app is deleted. A new install would thus
 * find the session token and the push keys of the person who used the app
 * before, and be signed in as that person. The app's key-value store is a
 * file in the app's container, which iOS deletes with the app. So a store
 * without the flag below is a first launch after an install: the app deletes
 * the session and the push items (also those in the app group), and then
 * sets the flag.
 *
 * Android deletes the Keystore items of an app with the app, so this does
 * nothing there.
 *
 * A later launch reads one value synchronously and does nothing more.
 */
const INSTALLED_FLAG = "farmer.installed";

/** Set after the items got the "this device only" accessibility. An item from
 *  an earlier build keeps its old accessibility until it is written again. */
const DEVICE_ONLY_FLAG = "farmer.keychain-device-only";

let done: Promise<void> | null = null;

/** The check and the wipe. `wipeAfterReinstall` runs it once a process. */
export const wipeIfFirstLaunch = async (): Promise<void> => {
	if (Platform.OS !== "ios") return;
	try {
		if (Storage.getItemSync(INSTALLED_FLAG)) return;
	} catch {
		// A store that cannot be read: do not wipe on a guess.
		return;
	}
	await Promise.all([
		SecureStore.deleteItemAsync(SESSION_KEY).catch(() => undefined),
		deleteAllPushItems(),
	]);
	try {
		Storage.setItemSync(INSTALLED_FLAG, "1");
	} catch {
		// The next launch tries again. It finds nothing new to delete.
	}
};

/** Write the Keychain items again with the "this device only" accessibility.
 *  The flag is set only when every item was read and written again, so a
 *  failure makes the next launch run it again. Never throws. */
export const migrateKeychainAccessibility = async (): Promise<void> => {
	if (Platform.OS !== "ios") return;
	try {
		if (Storage.getItemSync(DEVICE_ONLY_FLAG)) return;
		const results = await Promise.all([migrateSession(), migratePushItems()]);
		if (results.every(Boolean)) Storage.setItemSync(DEVICE_ONLY_FLAG, "1");
	} catch {
		// The next launch tries again.
	}
};

/** Delete the Keychain items of an earlier install, one time. Call it before
 *  the first read of the session. Never throws. */
export const wipeAfterReinstall = (): Promise<void> => {
	done ??= wipeIfFirstLaunch().then(migrateKeychainAccessibility);
	return done;
};
