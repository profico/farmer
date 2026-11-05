import {
	base64UrlToBytes,
	bytesToBase64Url,
	deviceKeyPairFromSeed,
	KEY_SEED_LENGTH,
	openSealedText,
	publicKeyOf,
} from "@farmer/push-crypto/device";
import { getRandomBytes } from "expo-crypto";

import { deleteItem, KEYS, readItem, writeItem } from "./storage";

/**
 * The device key pair (ADR 0006). The private key stays in the Keychain or
 * the Keystore; the server gets the public key and seals each push for it.
 */

const readPrivateKey = async (): Promise<Uint8Array | null> => {
	const stored = await readItem(KEYS.deviceKey);
	if (!stored) return null;
	try {
		const bytes = base64UrlToBytes(stored);
		return bytes.length === 32 ? bytes : null;
	} catch {
		return null;
	}
};

/** The public key to send to the server: the 65-byte point, base64url. Makes
 *  the key pair on the first call. */
export const devicePublicKey = async (): Promise<string> => {
	const existing = await readPrivateKey();
	if (existing) return bytesToBase64Url(publicKeyOf(existing));
	// expo-crypto reads the platform's secure random source. The pure
	// JavaScript crypto code never reads a random source itself.
	const pair = deviceKeyPairFromSeed(getRandomBytes(KEY_SEED_LENGTH));
	await writeItem(KEYS.deviceKey, bytesToBase64Url(pair.privateKey));
	return bytesToBase64Url(pair.publicKey);
};

/** Open a sealed push with the device key. Null when there is no key or the
 *  value does not open: a push for an old key is dropped, not shown. */
export const openPush = async (sealed: string): Promise<string | null> => {
	const privateKey = await readPrivateKey();
	if (!privateKey) return null;
	try {
		return openSealedText(privateKey, sealed);
	} catch {
		return null;
	}
};

/** Forget the key pair. The next registration makes a new one. */
export const forgetDeviceKey = () => deleteItem(KEYS.deviceKey);
