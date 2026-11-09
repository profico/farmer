/**
 * The device half of the push encryption contract, for the mobile app.
 *
 * `index.ts` uses `@hpke/core`, which needs WebCrypto (`crypto.subtle`), and
 * Node's `Buffer`. Hermes, the JavaScript engine of the app, has neither. This
 * file does the same HPKE base mode (RFC 9180) in pure JavaScript with the
 * `@noble` libraries:
 *
 *  - KEM: DHKEM(P-256, HKDF-SHA256), id 0x0010
 *  - KDF: HKDF-SHA256, id 0x0001
 *  - AEAD: AES-256-GCM, id 0x0002
 *
 * Do not import `./index` here: it pulls `@hpke/core` and `Buffer` into the
 * app bundle. The interop test (`device.test.ts`) seals with the server's
 * `sealForDevice` and opens with `openSealed` from this file.
 *
 * This file never asks for random bytes itself. Hermes has no
 * `crypto.getRandomValues`, so the app gives the seed of a key pair.
 */
import { gcm } from "@noble/ciphers/aes.js";
import { p256 } from "@noble/curves/nist.js";
import { expand, extract } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** The `info` value of a push. The same value as `PUSH_INFO` in `./index`. */
export const PUSH_INFO = "farmer push v1";

/** Bytes of the KEM output (`enc`): one uncompressed P-256 point. */
const ENC_LENGTH = 65;
/** Bytes of a P-256 private key (a scalar). */
const PRIVATE_KEY_LENGTH = 32;
/** Bytes of the AES-GCM tag. */
const TAG_LENGTH = 16;
/** Bytes of the seed that `deviceKeyPairFromSeed` reads: 1.5 times the
 *  scalar size, so the reduction modulo the curve order has no bias. */
export const KEY_SEED_LENGTH = 48;

// --- Bytes ------------------------------------------------------------------

/** UTF-8 bytes of a string. Written here, so that the file does not depend on
 *  `TextEncoder` in the JavaScript engine. */
export const utf8Encode = (value: string): Uint8Array => {
	const out: number[] = [];
	for (const char of value) {
		const code = char.codePointAt(0) ?? 0;
		if (code < 0x80) {
			out.push(code);
		} else if (code < 0x800) {
			out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		} else if (code < 0x10000) {
			out.push(
				0xe0 | (code >> 12),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f),
			);
		} else {
			out.push(
				0xf0 | (code >> 18),
				0x80 | ((code >> 12) & 0x3f),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f),
			);
		}
	}
	return new Uint8Array(out);
};

/** A string from UTF-8 bytes. Throws on bytes that are not UTF-8, so a
 *  damaged payload does not decode to wrong text. */
export const utf8Decode = (bytes: Uint8Array): string => {
	let out = "";
	let i = 0;
	const next = (): number => {
		const byte = bytes[i++];
		if (byte === undefined || (byte & 0xc0) !== 0x80) {
			throw new Error("The bytes are not UTF-8.");
		}
		return byte & 0x3f;
	};
	while (i < bytes.length) {
		const first = bytes[i++] ?? 0;
		let code: number;
		if (first < 0x80) {
			code = first;
		} else if ((first & 0xe0) === 0xc0) {
			code = ((first & 0x1f) << 6) | next();
			if (code < 0x80) throw new Error("The bytes are not UTF-8.");
		} else if ((first & 0xf0) === 0xe0) {
			code = ((first & 0x0f) << 12) | (next() << 6) | next();
			if (code < 0x800 || (code >= 0xd800 && code <= 0xdfff)) {
				throw new Error("The bytes are not UTF-8.");
			}
		} else if ((first & 0xf8) === 0xf0) {
			code = ((first & 0x07) << 18) | (next() << 12) | (next() << 6) | next();
			if (code < 0x10000 || code > 0x10ffff) {
				throw new Error("The bytes are not UTF-8.");
			}
		} else {
			throw new Error("The bytes are not UTF-8.");
		}
		out += String.fromCodePoint(code);
	}
	return out;
};

const ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** Base64url without padding (RFC 4648 section 5), with no `Buffer`. */
export const bytesToBase64Url = (bytes: Uint8Array): string => {
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i] ?? 0;
		const b = bytes[i + 1] ?? 0;
		const c = bytes[i + 2] ?? 0;
		const triple = (a << 16) | (b << 8) | c;
		const left = bytes.length - i;
		out += ALPHABET[(triple >> 18) & 0x3f];
		out += ALPHABET[(triple >> 12) & 0x3f];
		if (left > 1) out += ALPHABET[(triple >> 6) & 0x3f];
		if (left > 2) out += ALPHABET[triple & 0x3f];
	}
	return out;
};

/** Decode base64url without padding. Throws on any other character. */
export const base64UrlToBytes = (value: string): Uint8Array => {
	if (!BASE64URL.test(value) || value.length % 4 === 1) {
		throw new Error("The value is not base64url.");
	}
	const out = new Uint8Array(Math.floor((value.length * 3) / 4));
	let bits = 0;
	let buffer = 0;
	let o = 0;
	for (const char of value) {
		buffer = (buffer << 6) | ALPHABET.indexOf(char);
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[o++] = (buffer >> bits) & 0xff;
		}
	}
	return out;
};

const concat = (...parts: Uint8Array[]): Uint8Array => {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
};

/** I2OSP: an integer as `length` big-endian bytes. */
const i2osp = (value: number, length: number): Uint8Array => {
	const out = new Uint8Array(length);
	for (let i = length - 1, rest = value; i >= 0; i--, rest >>>= 8) {
		out[i] = rest & 0xff;
	}
	return out;
};

// --- HPKE (RFC 9180), base mode, receiver side --------------------------------

const HPKE_V1 = utf8Encode("HPKE-v1");
const KEM_SUITE_ID = concat(utf8Encode("KEM"), i2osp(0x0010, 2));
const HPKE_SUITE_ID = concat(
	utf8Encode("HPKE"),
	i2osp(0x0010, 2),
	i2osp(0x0001, 2),
	i2osp(0x0002, 2),
);
const EMPTY = new Uint8Array(0);

/** LabeledExtract (RFC 9180 section 4). */
const labeledExtract = (
	suiteId: Uint8Array,
	salt: Uint8Array,
	label: string,
	ikm: Uint8Array,
): Uint8Array =>
	extract(sha256, concat(HPKE_V1, suiteId, utf8Encode(label), ikm), salt);

/** LabeledExpand (RFC 9180 section 4). */
const labeledExpand = (
	suiteId: Uint8Array,
	prk: Uint8Array,
	label: string,
	info: Uint8Array,
	length: number,
): Uint8Array =>
	expand(
		sha256,
		prk,
		concat(i2osp(length, 2), HPKE_V1, suiteId, utf8Encode(label), info),
		length,
	);

/** DHKEM Decap (RFC 9180 section 4.1): the shared secret from the sender's
 *  ephemeral key and the device's private key. */
const decap = (enc: Uint8Array, privateKey: Uint8Array): Uint8Array => {
	// The DH value is the x-coordinate of the shared point: the bytes after
	// the 0x04 prefix of the uncompressed point, 32 of them.
	const point = p256.getSharedSecret(privateKey, enc, false);
	const dh = point.subarray(1, 33);
	const publicKey = p256.getPublicKey(privateKey, false);
	const kemContext = concat(enc, publicKey);
	const eaePrk = labeledExtract(KEM_SUITE_ID, EMPTY, "eae_prk", dh);
	return labeledExpand(KEM_SUITE_ID, eaePrk, "shared_secret", kemContext, 32);
};

/** The AEAD key and the base nonce of a base-mode context. */
type AeadContext = { key: Uint8Array; baseNonce: Uint8Array };

const keySchedule = (
	sharedSecret: Uint8Array,
	info: Uint8Array,
): AeadContext => {
	const pskIdHash = labeledExtract(HPKE_SUITE_ID, EMPTY, "psk_id_hash", EMPTY);
	const infoHash = labeledExtract(HPKE_SUITE_ID, EMPTY, "info_hash", info);
	// mode_base is 0x00.
	const context = concat(new Uint8Array([0x00]), pskIdHash, infoHash);
	const secret = labeledExtract(HPKE_SUITE_ID, sharedSecret, "secret", EMPTY);
	return {
		key: labeledExpand(HPKE_SUITE_ID, secret, "key", context, 32),
		baseNonce: labeledExpand(HPKE_SUITE_ID, secret, "base_nonce", context, 12),
	};
};

/**
 * Decrypt a value from the server's `sealForDevice` with the device's raw
 * private key (32 bytes). Throws when the value is too short, is not
 * base64url, or fails authentication (a changed byte, a different key, or a
 * different `info`).
 */
export const openSealed = (
	privateKey: Uint8Array,
	sealed: string,
	info: string = PUSH_INFO,
): Uint8Array => {
	if (privateKey.length !== PRIVATE_KEY_LENGTH) {
		throw new Error("The private key is not 32 bytes.");
	}
	const bytes = base64UrlToBytes(sealed);
	if (bytes.length < ENC_LENGTH + TAG_LENGTH) {
		throw new Error("The sealed value is too short.");
	}
	const enc = bytes.subarray(0, ENC_LENGTH);
	const { key, baseNonce } = keySchedule(
		decap(enc, privateKey),
		utf8Encode(info),
	);
	// The first message of the context: sequence 0, so the nonce is the base
	// nonce. The server seals one message for each context.
	try {
		return gcm(key, baseNonce).decrypt(bytes.subarray(ENC_LENGTH));
	} catch {
		throw new Error("The sealed value failed to open.");
	}
};

export const openSealedText = (
	privateKey: Uint8Array,
	sealed: string,
	info: string = PUSH_INFO,
): string => utf8Decode(openSealed(privateKey, sealed, info));

/** A device key pair. `privateKey` is the raw 32-byte scalar, which is also
 *  what CryptoKit reads (`P256.KeyAgreement.PrivateKey(rawRepresentation:)`).
 *  `publicKey` is the 65-byte uncompressed point that the server takes. */
export type DeviceKeyPair = { privateKey: Uint8Array; publicKey: Uint8Array };

/**
 * A key pair from `KEY_SEED_LENGTH` (48) random bytes. The caller gives the
 * bytes from the platform's secure random source; this file never reads a
 * random source.
 */
export const deviceKeyPairFromSeed = (seed: Uint8Array): DeviceKeyPair => {
	if (seed.length < KEY_SEED_LENGTH) {
		throw new Error(`The seed must be at least ${KEY_SEED_LENGTH} bytes.`);
	}
	// `keygen` reduces the seed into the range 1..n-1 without bias.
	const { secretKey } = p256.keygen(seed);
	return { privateKey: secretKey, publicKey: publicKeyOf(secretKey) };
};

/** The 65-byte uncompressed public key of a stored private key. */
export const publicKeyOf = (privateKey: Uint8Array): Uint8Array =>
	p256.getPublicKey(privateKey, false);
