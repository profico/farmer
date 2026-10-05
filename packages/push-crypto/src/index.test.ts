import { describe, expect, test } from "bun:test";

import {
	ENC_LENGTH,
	fromBase64Url,
	generateDeviceKeyPair,
	openOnDevice,
	PUSH_INFO,
	sealForDevice,
	toBase64Url,
} from "./index";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("sealForDevice / openOnDevice", () => {
	test("a sealed payload opens with the device's private key", async () => {
		const device = await generateDeviceKeyPair();
		expect(device.publicKeyRaw.byteLength).toBe(ENC_LENGTH);
		const plaintext = encoder.encode(
			JSON.stringify({ title: "Log your hours", body: "Friday is empty" }),
		);

		const sealed = await sealForDevice(device.publicKeyRaw, plaintext);

		expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(fromBase64Url(sealed).byteLength).toBe(
			ENC_LENGTH + plaintext.byteLength + 16,
		);
		const opened = await openOnDevice(device.privateKey, sealed);
		expect(decoder.decode(opened)).toBe(decoder.decode(plaintext));
	});

	test("two seals of the same plaintext differ", async () => {
		const device = await generateDeviceKeyPair();
		const plaintext = encoder.encode("same");
		const first = await sealForDevice(device.publicKeyRaw, plaintext);
		const second = await sealForDevice(device.publicKeyRaw, plaintext);
		expect(first).not.toBe(second);
	});

	test("the 64-byte x || y form of the public key also seals", async () => {
		const device = await generateDeviceKeyPair();
		const sealed = await sealForDevice(
			device.publicKeyRaw.subarray(1),
			encoder.encode("hi"),
			PUSH_INFO,
		);
		const opened = await openOnDevice(device.privateKey, sealed, PUSH_INFO);
		expect(decoder.decode(opened)).toBe("hi");
	});

	test("a changed ciphertext byte does not open", async () => {
		const device = await generateDeviceKeyPair();
		const sealed = await sealForDevice(
			device.publicKeyRaw,
			encoder.encode("payload"),
		);
		const bytes = fromBase64Url(sealed);
		const last = bytes.byteLength - 1;
		bytes[last] = (bytes[last] ?? 0) ^ 0x01;

		await expect(
			openOnDevice(device.privateKey, toBase64Url(bytes)),
		).rejects.toThrow(/open|decrypt|fail/i);
	});

	test("a different info does not open", async () => {
		const device = await generateDeviceKeyPair();
		const sealed = await sealForDevice(
			device.publicKeyRaw,
			encoder.encode("payload"),
			"farmer push v1",
		);
		await expect(
			openOnDevice(device.privateKey, sealed, "farmer push v2"),
		).rejects.toThrow(/open|decrypt|fail/i);
	});

	test("a different device's key does not open", async () => {
		const device = await generateDeviceKeyPair();
		const other = await generateDeviceKeyPair();
		const sealed = await sealForDevice(
			device.publicKeyRaw,
			encoder.encode("payload"),
		);
		await expect(openOnDevice(other.privateKey, sealed)).rejects.toThrow(
			/open|decrypt|fail/i,
		);
	});

	test("a value that is too short or not base64url is refused", async () => {
		const device = await generateDeviceKeyPair();
		await expect(openOnDevice(device.privateKey, "AAAA")).rejects.toThrow(
			"The sealed value is too short.",
		);
		await expect(openOnDevice(device.privateKey, "a+b/")).rejects.toThrow(
			"The value is not base64url.",
		);
	});

	test("a public key of the wrong length is refused", async () => {
		await expect(
			sealForDevice(new Uint8Array(33), encoder.encode("x")),
		).rejects.toThrow(/uncompressed P-256 point/);
	});
});
