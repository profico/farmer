/**
 * The proof that a phone holds a relay registration (ADR 0006).
 *
 * The relay gives the app a `deviceSecret` at registration. The relay keeps
 * only the SHA-256 hash of the secret. The app gives its server a proof, and
 * the server asks the relay to check it. The server never sees the secret.
 *
 * proof = base64url(HMAC-SHA256(key, message))
 *   key     = SHA-256(UTF-8 bytes of deviceSecret)
 *   message = UTF-8 bytes of "farmer-device-binding v1\n" + relayId + "\n"
 *             + publicKey
 *
 * The proof names the public key, so a proof cannot bind another key to the
 * relay id. `apps/push-relay/src/ids.ts` has the same function for the relay,
 * and each side pins the same test vector.
 *
 * This file uses `@noble` only, so the app can import it (see `device.ts`).
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { bytesToBase64Url, utf8Encode } from "./device";

/** The first line of the message. A change of the contract changes it. */
export const BINDING_CONTEXT = "farmer-device-binding v1";

export const bindingProof = (
	deviceSecret: string,
	relayId: string,
	publicKey: string,
): string =>
	bytesToBase64Url(
		hmac(
			sha256,
			sha256(utf8Encode(deviceSecret)),
			utf8Encode(`${BINDING_CONTEXT}\n${relayId}\n${publicKey}`),
		),
	);
