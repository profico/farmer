/**
 * The encryption contract between a farmer server and the mobile app, for a
 * push through the push relay (`apps/push-relay`). The relay forwards the
 * sealed value and cannot open it: only the device has the private key.
 *
 * The suite is HPKE base mode (RFC 9180): DHKEM(P-256, HKDF-SHA256) (0x0010),
 * HKDF-SHA256 (0x0001) and AES-256-GCM (0x0002). On iOS this is CryptoKit's
 * `HPKE.Ciphersuite.P256_SHA256_AES_GCM_256`.
 *
 * The sealed value is `base64url(enc || ct)`, with no padding. `enc` is the
 * 65-byte uncompressed P-256 point of the ephemeral key. `ct` is the AES-GCM
 * output with its 16-byte tag at the end.
 *
 * The device gives its server the public key as the 65-byte uncompressed point
 * (`0x04 || x || y`). On iOS that is `x963Representation`, not
 * `rawRepresentation` (64 bytes, no prefix). `sealForDevice` also accepts the
 * 64-byte form and adds the prefix.
 *
 * The mobile app imports `@farmer/push-crypto/device` (`device.ts`) and not
 * this file, because Hermes has no WebCrypto and no `Buffer`. `device.test.ts`
 * seals here and opens there.
 */
import {
	Aes256Gcm,
	CipherSuite,
	DhkemP256HkdfSha256,
	HkdfSha256,
} from "@hpke/core";

import { PUSH_ID_BYTES, type PushEnvelope, type PushKind } from "./freshness";

export {
	checkFreshness,
	PUSH_KINDS,
	PUSH_MAX_AGE_MS,
	type PushEnvelope,
	type PushKind,
} from "./freshness";

/** The `info` value that a farmer server and the app use for a push. A new
 *  version of the plaintext format gets a new value, so an old app cannot
 *  open a payload that it cannot read. */
export const PUSH_INFO = "farmer push v1";

/** Bytes of the KEM output (`enc`): one uncompressed P-256 point. */
export const ENC_LENGTH = 65;

/** Bytes of the AES-GCM tag at the end of every ciphertext. */
const TAG_LENGTH = 16;

const suite = new CipherSuite({
	kem: new DhkemP256HkdfSha256(),
	kdf: new HkdfSha256(),
	aead: new Aes256Gcm(),
});

const encoder = new TextEncoder();

/** A copy of the bytes in a fresh `ArrayBuffer`, the input type that
 *  `@hpke/core` and WebCrypto take. A `Uint8Array` can be a view into a
 *  larger buffer, so its `.buffer` is not always the same bytes. */
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const copy = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(copy).set(bytes);
	return copy;
};

const infoBytes = (info: string | Uint8Array): ArrayBuffer =>
	toArrayBuffer(info instanceof Uint8Array ? info : encoder.encode(info));

/** Base64url without padding (RFC 4648 section 5). */
export const toBase64Url = (bytes: Uint8Array): string =>
	Buffer.from(bytes).toString("base64url");

const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** Decode base64url without padding. Throws on any other character, so a
 *  value from a different alphabet does not decode to wrong bytes. */
export const fromBase64Url = (value: string): Uint8Array => {
	if (!BASE64URL.test(value) || value.length % 4 === 1) {
		throw new Error("The value is not base64url.");
	}
	return new Uint8Array(Buffer.from(value, "base64url"));
};

/** The 65-byte uncompressed point. A 64-byte `x || y` (CryptoKit's
 *  `rawRepresentation`) gets the `0x04` prefix. */
const uncompressedPoint = (publicKeyRaw: Uint8Array): Uint8Array => {
	if (publicKeyRaw.byteLength === ENC_LENGTH && publicKeyRaw[0] === 0x04) {
		return publicKeyRaw;
	}
	if (publicKeyRaw.byteLength === ENC_LENGTH - 1) {
		const point = new Uint8Array(ENC_LENGTH);
		point[0] = 0x04;
		point.set(publicKeyRaw, 1);
		return point;
	}
	throw new Error(
		"The public key is not an uncompressed P-256 point (65 bytes, 0x04 first).",
	);
};

/**
 * Encrypt a push payload for one device. Returns `base64url(enc || ct)`.
 *
 * `publicKeyRaw` is the device's P-256 public key as an uncompressed point.
 * `info` binds the result to its purpose; use `PUSH_INFO`.
 */
export const sealForDevice = async (
	publicKeyRaw: Uint8Array,
	plaintext: Uint8Array,
	info: string | Uint8Array = PUSH_INFO,
): Promise<string> => {
	const recipientPublicKey = await suite.kem.deserializePublicKey(
		toArrayBuffer(uncompressedPoint(publicKeyRaw)),
	);
	const sender = await suite.createSenderContext({
		recipientPublicKey,
		info: infoBytes(info),
	});
	const ciphertext = new Uint8Array(
		await sender.seal(toArrayBuffer(plaintext)),
	);
	const sealed = new Uint8Array(ENC_LENGTH + ciphertext.byteLength);
	sealed.set(new Uint8Array(sender.enc), 0);
	sealed.set(ciphertext, ENC_LENGTH);
	return toBase64Url(sealed);
};

/**
 * Decrypt a value from `sealForDevice` with the device's private key. Throws
 * when the value is too short, is not base64url, or fails authentication (a
 * changed byte, a different key, or a different `info`).
 */
export const openOnDevice = async (
	privateKey: CryptoKey,
	sealed: string,
	info: string | Uint8Array = PUSH_INFO,
): Promise<Uint8Array> => {
	const bytes = fromBase64Url(sealed);
	if (bytes.byteLength < ENC_LENGTH + TAG_LENGTH) {
		throw new Error("The sealed value is too short.");
	}
	const recipient = await suite.createRecipientContext({
		recipientKey: privateKey,
		enc: toArrayBuffer(bytes.subarray(0, ENC_LENGTH)),
		info: infoBytes(info),
	});
	return new Uint8Array(
		await recipient.open(toArrayBuffer(bytes.subarray(ENC_LENGTH))),
	);
};

/** A device key pair: the private key stays on the device, and
 *  `publicKeyRaw` (65 bytes) goes to the server. For tests and for a
 *  JavaScript client; the iOS app makes its key with CryptoKit. */
export const generateDeviceKeyPair = async (): Promise<{
	privateKey: CryptoKey;
	publicKeyRaw: Uint8Array;
}> => {
	const pair = await suite.kem.generateKeyPair();
	const publicKeyRaw = new Uint8Array(
		await suite.kem.serializePublicKey(pair.publicKey),
	);
	return { privateKey: pair.privateKey, publicKeyRaw };
};

/** The freshness fields of one push (`./freshness`): its relay kind, the
 *  send time and a new random id. For the server only: the id needs a random
 *  source, which the app's engine does not have. */
export const pushEnvelope = (
	pushKind: PushKind,
	nowMs: number = Date.now(),
): PushEnvelope => ({
	pushKind,
	sentAt: nowMs,
	id: toBase64Url(crypto.getRandomValues(new Uint8Array(PUSH_ID_BYTES))),
});
