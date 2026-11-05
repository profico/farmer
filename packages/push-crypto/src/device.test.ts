import { describe, expect, test } from "bun:test";

import {
	base64UrlToBytes,
	bytesToBase64Url,
	deviceKeyPairFromSeed,
	KEY_SEED_LENGTH,
	openSealed,
	openSealedText,
	publicKeyOf,
	utf8Decode,
	utf8Encode,
} from "./device";
import {
	checkFreshness,
	emptyPushSeen,
	PUSH_MAX_AGE_MS,
	PUSH_MAX_SKEW_MS,
	type PushEnvelope,
	PUSH_SEEN_LIMIT,
	rememberPushId,
} from "./freshness";
import {
	fromBase64Url,
	PUSH_INFO,
	pushEnvelope,
	sealForDevice,
	toBase64Url,
} from "./index";

const encoder = new TextEncoder();

const seed = () => crypto.getRandomValues(new Uint8Array(KEY_SEED_LENGTH));

// The server seals with `@hpke/core` on WebCrypto; the app opens with the
// pure-JavaScript code of `./device`. These tests prove the two agree.
describe("interop: sealForDevice (server) / openSealed (device)", () => {
	test("a payload that the server seals opens on the device", async () => {
		const device = deviceKeyPairFromSeed(seed());
		expect(device.publicKey.byteLength).toBe(65);
		expect(device.publicKey[0]).toBe(0x04);
		expect(device.privateKey.byteLength).toBe(32);
		const payload = JSON.stringify({
			kind: "log-reminder",
			title: "Log your hours",
			body: "Friday is empty. Čestitamo, 日本語 and 🌾 too.",
			url: "/",
		});

		const sealed = await sealForDevice(
			device.publicKey,
			encoder.encode(payload),
			PUSH_INFO,
		);

		expect(openSealedText(device.privateKey, sealed)).toBe(payload);
	});

	test("the server accepts the base64url public key that the app sends", async () => {
		const device = deviceKeyPairFromSeed(seed());
		// The app sends `bytesToBase64Url(publicKey)`; the server decodes it
		// with its own codec.
		const sent = bytesToBase64Url(device.publicKey);
		expect(sent).toHaveLength(87);
		const sealed = await sealForDevice(
			fromBase64Url(sent),
			encoder.encode("hi"),
		);
		expect(openSealedText(device.privateKey, sealed)).toBe("hi");
	});

	test("a changed byte does not open", async () => {
		const device = deviceKeyPairFromSeed(seed());
		const sealed = await sealForDevice(
			device.publicKey,
			encoder.encode("payload"),
		);
		for (const index of [0, 70, -1]) {
			const bytes = fromBase64Url(sealed);
			const at = index < 0 ? bytes.byteLength + index : index;
			bytes[at] = (bytes[at] ?? 0) ^ 0x01;
			expect(() => openSealed(device.privateKey, toBase64Url(bytes))).toThrow(
				/failed to open|point|invalid|bad/i,
			);
		}
	});

	test("a different info or a different key does not open", async () => {
		const device = deviceKeyPairFromSeed(seed());
		const other = deviceKeyPairFromSeed(seed());
		const sealed = await sealForDevice(
			device.publicKey,
			encoder.encode("payload"),
			PUSH_INFO,
		);
		expect(() =>
			openSealed(device.privateKey, sealed, "farmer push v2"),
		).toThrow("The sealed value failed to open.");
		expect(() => openSealed(other.privateKey, sealed)).toThrow(
			"The sealed value failed to open.",
		);
	});

	test("a short value, a bad alphabet and a short seed are refused", () => {
		const device = deviceKeyPairFromSeed(seed());
		expect(() => openSealed(device.privateKey, "AAAA")).toThrow(
			"The sealed value is too short.",
		);
		expect(() => openSealed(device.privateKey, "a+b/")).toThrow(
			"The value is not base64url.",
		);
		expect(() => deviceKeyPairFromSeed(new Uint8Array(32))).toThrow(
			"The seed must be at least 48 bytes.",
		);
	});

	test("the same seed gives the same key pair", () => {
		const bytes = seed();
		const first = deviceKeyPairFromSeed(bytes);
		const second = deviceKeyPairFromSeed(bytes);
		expect(bytesToBase64Url(first.privateKey)).toBe(
			bytesToBase64Url(second.privateKey),
		);
		expect(bytesToBase64Url(publicKeyOf(first.privateKey))).toBe(
			bytesToBase64Url(first.publicKey),
		);
	});
});

describe("the device codecs", () => {
	test("base64url matches the server's codec for every length", () => {
		for (let length = 0; length < 70; length++) {
			const bytes = crypto.getRandomValues(new Uint8Array(length));
			const encoded = bytesToBase64Url(bytes);
			expect(encoded).toBe(toBase64Url(bytes));
			expect(Array.from(base64UrlToBytes(encoded))).toEqual(Array.from(bytes));
		}
	});

	test("UTF-8 matches TextEncoder and TextDecoder", () => {
		const text = 'a é ć ž € 日本 🌾 \n\t"';
		expect(Array.from(utf8Encode(text))).toEqual(
			Array.from(encoder.encode(text)),
		);
		expect(utf8Decode(encoder.encode(text))).toBe(text);
		expect(() => utf8Decode(new Uint8Array([0xc3]))).toThrow(
			"The bytes are not UTF-8.",
		);
	});
});

describe("interop: the freshness fields", () => {
	/** Seal a payload with the server's envelope, open it on the device, and
	 *  read the envelope back as the app does. */
	const roundTrip = async (kind: "alert" | "data", nowMs: number) => {
		const device = deviceKeyPairFromSeed(seed());
		const payload = {
			kind: "log-reminder",
			title: "Log your hours",
			body: "Friday is empty.",
			...pushEnvelope(kind, nowMs),
		};
		const sealed = await sealForDevice(
			device.publicKey,
			encoder.encode(JSON.stringify(payload)),
			PUSH_INFO,
		);
		// SAFETY: the test sealed `JSON.stringify(payload)` one line above.
		return JSON.parse(
			openSealedText(device.privateKey, sealed),
		) as typeof payload;
	};

	test("a fresh payload of the right kind is accepted once", async () => {
		const now = Date.now();
		const opened = await roundTrip("alert", now);
		expect(opened.pushKind).toBe("alert");
		expect(opened.sentAt).toBe(now);
		expect(opened.id).toMatch(/^[A-Za-z0-9_-]{12}$/);
		expect(checkFreshness(opened, "alert", now + 1000, emptyPushSeen())).toBe(
			"ok",
		);
		const seen = rememberPushId(emptyPushSeen(), opened, now + 1000);
		expect(checkFreshness(opened, "alert", now + 2000, seen)).toBe("replayed");
	});

	test("a payload in a push of another kind is refused", async () => {
		const now = Date.now();
		const opened = await roundTrip("data", now);
		expect(checkFreshness(opened, "alert", now, emptyPushSeen())).toBe(
			"wrong_kind",
		);
		expect(checkFreshness(opened, null, now, emptyPushSeen())).toBe(
			"wrong_kind",
		);
	});

	test("a payload older than 24 hours is refused", async () => {
		const now = Date.now();
		const opened = await roundTrip("alert", now - PUSH_MAX_AGE_MS - 1);
		expect(checkFreshness(opened, "alert", now, emptyPushSeen())).toBe("stale");
	});

	test("each push gets a new id", () => {
		const ids = new Set(
			Array.from({ length: 100 }, () => pushEnvelope("alert").id),
		);
		expect(ids.size).toBe(100);
	});

	test("a payload sent in the future is refused", async () => {
		const now = Date.now();
		const near = await roundTrip("alert", now + PUSH_MAX_SKEW_MS);
		expect(checkFreshness(near, "alert", now, emptyPushSeen())).toBe("ok");
		const far = await roundTrip("alert", now + PUSH_MAX_SKEW_MS + 1);
		expect(checkFreshness(far, "alert", now, emptyPushSeen())).toBe("future");
	});
});

describe("the seen list", () => {
	const envelope = (id: string, sentAt: number): PushEnvelope => ({
		pushKind: "alert",
		sentAt,
		id,
	});

	test("an id stays until its payload is stale, not for a count of pushes", () => {
		const t0 = 1_000_000_000_000;
		const first = envelope("first", t0);
		let seen = rememberPushId(emptyPushSeen(), first, t0);
		// 100 newer pushes, many more than the old limit of 50.
		for (let i = 1; i <= 100; i += 1) {
			seen = rememberPushId(seen, envelope(`id-${i}`, t0 + i), t0 + i);
		}
		const now = t0 + 1000;
		expect(checkFreshness(first, "alert", now, seen)).toBe("replayed");
		const late = t0 + 100 + PUSH_MAX_AGE_MS + 1;
		expect(checkFreshness(first, "alert", late, seen)).toBe("stale");
		const pruned = rememberPushId(seen, envelope("later", late), late);
		expect(pruned.entries.map((entry) => entry.id)).toEqual(["later"]);
	});

	test("a full list forgets the oldest id and refuses it by time", () => {
		const t0 = 1_000_000_000_000;
		let seen = emptyPushSeen();
		for (let i = 0; i < PUSH_SEEN_LIMIT + 10; i += 1) {
			seen = rememberPushId(seen, envelope(`id-${i}`, t0 + i), t0 + i);
		}
		const now = t0 + PUSH_SEEN_LIMIT + 10;
		expect(seen.entries).toHaveLength(PUSH_SEEN_LIMIT);
		expect(seen.entries.some((entry) => entry.id === "id-0")).toBe(false);
		// The forgotten id fails the floor check, so it is not replayable.
		expect(checkFreshness(envelope("id-0", t0), "alert", now, seen)).toBe(
			"stale",
		);
		expect(checkFreshness(envelope("id-9", t0 + 9), "alert", now, seen)).toBe(
			"stale",
		);
		// A new push still passes: the list never blocks a fresh push.
		expect(checkFreshness(envelope("new", now), "alert", now, seen)).toBe("ok");
	});
});
