import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pruneStaleDevices, STALE_DEVICE_MS, startPruning } from "./prune";
import { DeviceStore } from "./store";

let directory = "";

afterEach(() => {
	if (directory) rmSync(directory, { recursive: true, force: true });
	directory = "";
});

describe("DeviceStore.open", () => {
	test("makes the database's directory and keeps a device across a reopen", () => {
		directory = mkdtempSync(join(tmpdir(), "push-relay-"));
		const path = join(directory, "nested", "data", "relay.sqlite");

		const first = DeviceStore.open(path);
		first.insert({
			relayId: "relay-id-0123456789ab",
			platform: "android",
			pushToken: "token-0123456789",
			apnsEnvironment: null,
			liveActivityStartToken: null,
			secretHash: "0".repeat(64),
			createdAt: 1,
			updatedAt: 1,
			lastSeenAt: 1,
		});
		first.close();

		expect(existsSync(path)).toBe(true);
		const second = DeviceStore.open(path);
		expect(second.find("relay-id-0123456789ab")?.pushToken).toBe(
			"token-0123456789",
		);
		second.close();
	});
});

describe("pruneStaleDevices", () => {
	const add = (store: DeviceStore, relayId: string, lastSeenAt: number) =>
		store.insert({
			relayId,
			platform: "android",
			pushToken: "token-0123456789",
			apnsEnvironment: null,
			liveActivityStartToken: null,
			secretHash: "0".repeat(64),
			createdAt: lastSeenAt,
			updatedAt: lastSeenAt,
			lastSeenAt,
		});

	test("deletes devices unseen for 180 days and keeps the others", () => {
		const store = DeviceStore.open(":memory:");
		const now = Date.UTC(2026, 9, 6);
		const day = 24 * 60 * 60_000;
		add(store, "stale-device-0000000", now - 181 * day);
		add(store, "fresh-device-0000000", now - 179 * day);
		const logs: string[] = [];

		expect(pruneStaleDevices(store, now, (line) => logs.push(line))).toBe(1);

		expect(store.find("stale-device-0000000")).toBeNull();
		expect(store.find("fresh-device-0000000")).not.toBeNull();
		expect(logs).toEqual(["[push-relay] pruned 1 stale devices"]);
		expect(STALE_DEVICE_MS).toBe(180 * day);
	});

	test("startPruning prunes one time at start", () => {
		const store = DeviceStore.open(":memory:");
		const now = Date.UTC(2026, 9, 6);
		add(store, "stale-device-0000000", now - STALE_DEVICE_MS - 1);
		const stop = startPruning(
			store,
			() => now,
			() => {},
		);
		stop();
		expect(store.find("stale-device-0000000")).toBeNull();
	});
});
