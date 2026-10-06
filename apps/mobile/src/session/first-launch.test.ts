// The first launch after an install on iOS deletes the Keychain items of the
// earlier install. The native stores are fakes that record each call.

import { beforeEach, describe, expect, mock, test } from "bun:test";

const kv = new Map<string, string>();
const deleted: string[] = [];
const platform = { OS: "ios" };

mock.module("react-native", () => ({ Platform: platform }));
mock.module("expo-sqlite/kv-store", () => ({
	default: {
		getItemSync: (key: string) => kv.get(key) ?? null,
		setItemSync: (key: string, value: string) => {
			kv.set(key, value);
		},
	},
}));
mock.module("expo-secure-store", () => ({
	AFTER_FIRST_UNLOCK: 0,
	deleteItemAsync: async (key: string) => {
		deleted.push(key);
	},
	getItemAsync: async () => null,
	setItemAsync: async () => undefined,
}));

// The push store is a fake too: it records the delete of the push items as
// one entry. `bun test --isolate` keeps this mock out of the other files.
mock.module("../push/storage", () => ({
	deleteAllPushItems: async () => {
		deleted.push("push-items");
	},
}));

const { wipeIfFirstLaunch } = await import("./first-launch");

beforeEach(() => {
	kv.clear();
	deleted.length = 0;
	platform.OS = "ios";
});

describe("wipeAfterReinstall", () => {
	test("the first launch deletes the session and the push items, then sets the flag", async () => {
		await wipeIfFirstLaunch();
		expect(deleted).toContain("farmer.session");
		expect(deleted).toContain("push-items");
		expect(kv.get("farmer.installed")).toBe("1");
	});

	test("a later launch deletes nothing", async () => {
		kv.set("farmer.installed", "1");
		await wipeIfFirstLaunch();
		expect(deleted).toEqual([]);
	});

	test("Android deletes nothing", async () => {
		platform.OS = "android";
		await wipeIfFirstLaunch();
		expect(deleted).toEqual([]);
		expect(kv.has("farmer.installed")).toBe(false);
	});
});
