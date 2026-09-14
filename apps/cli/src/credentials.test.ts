import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCredentialStore, type Keyring } from "./credentials";

const ORIGIN = "https://farmer.test";

// What `Bun.secrets` does on a Linux machine with no Secret Service.
const brokenKeyring: Keyring = {
	get: () => Promise.reject(new Error("no keyring")),
	set: () => Promise.reject(new Error("no keyring")),
	delete: () => Promise.reject(new Error("no keyring")),
};

let dir = "";
let filePath = "";

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "farmer-cli-"));
	filePath = join(dir, "farmer", "credentials.json");
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("createCredentialStore", () => {
	test("falls back to a file only its owner can read when the keyring throws", async () => {
		const store = createCredentialStore(brokenKeyring, filePath);
		expect(await store.set(ORIGIN, "session-token")).toBe("file");
		expect((await stat(filePath)).mode & 0o777).toBe(0o600);
		expect(await store.get(ORIGIN)).toBe("session-token");

		await store.delete(ORIGIN);
		expect(await store.get(ORIGIN)).toBeNull();
		expect(await Bun.file(filePath).exists()).toBe(false);
	});

	test("with no keyring (FARMER_NO_KEYRING=1) the file is used directly", async () => {
		const store = createCredentialStore(null, filePath);
		expect(await store.set(ORIGIN, "session-token")).toBe("file");
		expect(await store.set("https://other.test", "other-token")).toBe("file");
		expect(await store.get(ORIGIN)).toBe("session-token");
		expect(await store.get("https://other.test")).toBe("other-token");
	});

	test("a working keyring keeps the token out of the file", async () => {
		const tokens = new Map<string, string>();
		const keyring: Keyring = {
			get: async (origin) => tokens.get(origin) ?? null,
			set: async (origin, token) => {
				tokens.set(origin, token);
			},
			delete: async (origin) => {
				tokens.delete(origin);
			},
		};
		// A token left in the file from a session without a keyring.
		await createCredentialStore(null, filePath).set(ORIGIN, "old-token");

		const store = createCredentialStore(keyring, filePath);
		expect(await store.set(ORIGIN, "new-token")).toBe("keyring");
		expect(await store.get(ORIGIN)).toBe("new-token");
		expect(await Bun.file(filePath).exists()).toBe(false);
	});
});
