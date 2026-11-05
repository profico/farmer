// The order of a push sign-out, and that a sign-out stops a `syncPush` in
// flight. The native modules and the network are fakes: the test records
// each step in `log`.

import { beforeEach, describe, expect, mock, test } from "bun:test";

const log: string[] = [];
const registered: string[] = [];
const items = new Map<string, string>();

/** A promise that the test resolves by hand, to hold a step of the sync. */
const gate = () => {
	let open = () => {};
	const promise = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { promise, open };
};
let relayUrlGate = gate();

mock.module("expo-constants", () => ({ default: { expoConfig: {} } }));
mock.module("expo-crypto", () => ({ randomUUID: () => "install-1" }));
mock.module("expo-notifications", () => ({
	getDevicePushTokenAsync: async () => ({ data: "native-token" }),
	getPermissionsAsync: async () => ({ granted: true }),
	IosAuthorizationStatus: { PROVISIONAL: 3 },
}));
const platform = { OS: "android" };
const relayUpdates: { liveActivityToken?: string | null }[] = [];
mock.module("react-native", () => ({ Platform: platform }));
mock.module("../../modules/live-activity", () => ({ LiveActivity: null }));
mock.module("../config", () => ({ APP_VERSION: "1.0.0" }));
mock.module("./keys", () => ({
	devicePublicKey: async () => {
		log.push("key:read-or-make");
		return "public-key";
	},
	forgetDeviceKey: async () => {
		log.push("key:forget");
	},
}));
mock.module("./timer-surface", () => ({
	forgetCredential: async () => {
		log.push("credential:forget");
	},
}));
mock.module("./server", () => ({
	serverRelayUrl: async () => {
		await relayUrlGate.promise;
		return "https://relay.example";
	},
	registerDevice: async (
		_origin: string,
		_token: string,
		device: { relayProof: string },
	) => {
		log.push("server:register");
		registered.push(device.relayProof);
		return "ok";
	},
	updateDevice: async () => {
		log.push("server:update-device");
		return "ok";
	},
	removeDevice: async () => "ok",
}));
mock.module("./relay", () => ({
	registerWithRelay: async () => {
		log.push("relay:register");
		return { relayId: "relay-1", deviceSecret: "secret" };
	},
	updateRelay: async (
		_url: string,
		_credentials: { relayId: string },
		update: { liveActivityToken?: string | null },
	) => {
		if (update.liveActivityToken !== undefined) {
			log.push("relay:bind-activity");
			relayUpdates.push(update);
		}
		return "ok";
	},
	removeFromRelay: async () => {
		log.push("relay:delete");
		return "ok";
	},
}));
mock.module("./storage", () => ({
	KEYS: { installation: "installation", relay: "relay" },
	readItem: async (key: string) => items.get(key) ?? null,
	writeItem: async (key: string, value: string) => {
		items.set(key, value);
	},
	deleteItem: async (key: string) => {
		items.delete(key);
	},
	readRelay: async () => {
		const raw = items.get("relay");
		return raw ? JSON.parse(raw) : null;
	},
	writeRelay: async (value: { relayId: string }) => {
		log.push("relay:write");
		items.set("relay", JSON.stringify(value));
	},
}));

const { bindingProof } = await import("@farmer/push-crypto/binding");
const { reportLiveActivityToken, syncPush, teardownPush } =
	await import("./registration");

const SESSION = { origin: "https://farmer.example", token: "t" };

beforeEach(() => {
	log.length = 0;
	registered.length = 0;
	relayUpdates.length = 0;
	platform.OS = "android";
	items.clear();
	relayUrlGate = gate();
});

describe("teardownPush", () => {
	test("clears the device key and the credential before the relay DELETE", async () => {
		relayUrlGate.open();
		await syncPush(SESSION);
		log.length = 0;

		await teardownPush();

		expect(log).toEqual(["key:forget", "credential:forget", "relay:delete"]);
		expect(items.has("relay")).toBe(false);
	});

	test("stops a syncPush in flight: it writes nothing after the sign-out", async () => {
		const sync = syncPush(SESSION);
		const teardown = teardownPush();
		relayUrlGate.open();
		await Promise.all([sync, teardown]);

		expect(log).toEqual(["key:forget", "credential:forget"]);
		expect(items.has("relay")).toBe(false);
	});

	test("a sync after the sign-out runs again, for the new session", async () => {
		const stale = syncPush(SESSION);
		const teardown = teardownPush();
		relayUrlGate.open();
		await Promise.all([stale, teardown]);
		log.length = 0;

		await syncPush(SESSION);

		expect(log).toContain("server:register");
	});
});

describe("syncPush", () => {
	test("gives the Server a proof that the relay secret made", async () => {
		relayUrlGate.open();
		await syncPush(SESSION);

		expect(registered).toEqual([
			bindingProof("secret", "relay-1", "public-key"),
		]);
	});
});

describe("the Live Activity token on each sync", () => {
	const TOKEN = "a".repeat(64);

	test("makes no relay call while no activity runs", async () => {
		platform.OS = "ios";
		relayUrlGate.open();
		await syncPush(SESSION);
		await syncPush(SESSION);

		expect(relayUpdates).toEqual([]);
	});

	test("binds the token again, relay first, then reports it", async () => {
		platform.OS = "ios";
		relayUrlGate.open();
		await syncPush(SESSION);
		await reportLiveActivityToken(SESSION, { liveActivityToken: TOKEN });
		// The app now believes that the relay holds the token. A second sync
		// must still send it, because the relay may have lost it.
		relayUpdates.length = 0;
		log.length = 0;

		await syncPush(SESSION);

		expect(relayUpdates).toEqual([{ liveActivityToken: TOKEN }]);
		expect(log.indexOf("relay:bind-activity")).toBeGreaterThanOrEqual(0);
		expect(log.indexOf("relay:bind-activity")).toBeLessThan(
			log.indexOf("server:update-device"),
		);
	});
});
