import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { z } from "zod";

import { rewriteItem } from "../session/rewrite-item";

/**
 * What the push code keeps on the phone. Every item is in the Keychain or
 * the Keystore (expo-secure-store).
 *
 * On iOS the device key and the credential copy are in the app group
 * `group.com.profico.farmer`, so that the Notification Service Extension and
 * the Live Activity widget can read them. They are readable after the first
 * unlock: a push arrives on a locked phone, and an item that is readable only
 * while the phone is unlocked would not open then. Every item is "this device
 * only": a backup restore onto a second phone must not carry the identity of
 * the first phone.
 */

/** The app group, which is also the Keychain access group of the shared
 *  items. The iOS config plugin (`plugins/with-ios-push.ts`) adds it to the
 *  entitlements of the app and of each extension. */
export const APP_GROUP = "group.com.profico.farmer";

/** The Keychain service of the shared items. Swift reads the service
 *  "farmer.push:no-auth": expo-secure-store adds the suffix. */
const SERVICE = "farmer.push";

const local: SecureStore.SecureStoreOptions = {
	keychainService: SERVICE,
	keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const shared: SecureStore.SecureStoreOptions =
	Platform.OS === "ios" ? { ...local, accessGroup: APP_GROUP } : local;

export const KEYS = {
	/** The device's P-256 private key: 32 bytes, base64url. Swift reads it
	 *  with `P256.KeyAgreement.PrivateKey(rawRepresentation:)`. */
	deviceKey: "farmer.push.device-key",
	/** `{ origin, token }` for the Pause button of the Live Activity. */
	credential: "farmer.push.credential",
	installation: "farmer.push.installation",
	relay: "farmer.push.relay",
	/** Set when the timer card showed the hint "Notifications are off". The
	 *  hint shows one time only. */
	deniedHintShown: "farmer.push.denied-hint-shown",
} as const;

type Key = (typeof KEYS)[keyof typeof KEYS];

const optionsFor = (key: Key): SecureStore.SecureStoreOptions =>
	key === KEYS.deviceKey || key === KEYS.credential ? shared : local;

export const readItem = (key: Key): Promise<string | null> =>
	SecureStore.getItemAsync(key, optionsFor(key));

export const writeItem = (key: Key, value: string): Promise<void> =>
	SecureStore.setItemAsync(key, value, optionsFor(key));

export const deleteItem = (key: Key): Promise<void> =>
	SecureStore.deleteItemAsync(key, optionsFor(key));

/** Delete every push item, in the app's Keychain and in the app group. For
 *  the first launch after an install (`src/session/first-launch.ts`). */
export const deleteAllPushItems = async (): Promise<void> => {
	await Promise.all(
		Object.values(KEYS).map((key) => deleteItem(key).catch(() => undefined)),
	);
};

/** Write every push item again, so that an item from an earlier build gets
 *  the "this device only" accessibility (see `rewriteItem`). Returns true
 *  only when every item is done, so that the caller tries again at the next
 *  launch after a failure. Never throws. */
export const migratePushItems = async (): Promise<boolean> => {
	let allDone = true;
	for (const key of Object.values(KEYS)) {
		const done = await rewriteItem({
			read: () => readItem(key),
			remove: () => deleteItem(key),
			write: (value) => writeItem(key, value),
		});
		allDone &&= done;
	}
	return allDone;
};

/** The relay registration of this installation. */
const relayRegistration = z.object({
	/** The relay this registration belongs to. A Server that names another
	 *  relay needs a new registration. */
	relayUrl: z.string(),
	relayId: z.string(),
	deviceSecret: z.string(),
	pushToken: z.string(),
	pushToStartToken: z.string().nullable(),
	/** The per-activity token that the relay holds for this device. Absent
	 *  or null: none. */
	activityToken: z.string().nullable().optional(),
	/** Unix milliseconds of the last successful `PUT` or `POST`. */
	checkedAt: z.number(),
});
export type RelayRegistration = z.output<typeof relayRegistration>;

export const readRelay = async (): Promise<RelayRegistration | null> => {
	const raw = await readItem(KEYS.relay);
	if (!raw) return null;
	try {
		const parsed = relayRegistration.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
};

export const writeRelay = (registration: RelayRegistration) =>
	writeItem(KEYS.relay, JSON.stringify(registration));
