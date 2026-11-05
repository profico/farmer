import { Database } from "bun:sqlite";
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

describe("DeviceStore column migration", () => {
	test("renames last_push_ok_at and backfills the proof and the token time", () => {
		directory = mkdtempSync(join(tmpdir(), "push-relay-"));
		const path = join(directory, "relay.sqlite");
		const old = new Database(path, { create: true });
		old.run(`CREATE TABLE device (
			relay_id TEXT PRIMARY KEY,
			platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
			push_token TEXT NOT NULL,
			apns_environment TEXT,
			live_activity_start_token TEXT,
			secret_hash TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			last_seen_at INTEGER NOT NULL,
			last_push_ok_at INTEGER
		) STRICT`);
		old.run(
			`INSERT INTO device VALUES ('old-relay-id-0123456789', 'android', 'tok-0123456789', NULL, NULL, 'h', 1, 1, 7, NULL)`,
		);
		old.run(
			`INSERT INTO device VALUES ('push-relay-id-012345678', 'android', 'tok-0123456789', NULL, NULL, 'h', 2, 2, 7, 5)`,
		);
		old.run(
			`INSERT INTO device VALUES ('junk-relay-id-01234567', 'android', 'tok-junk', NULL, NULL, 'h', 3, 3, 3, NULL)`,
		);
		old.close();

		const store = DeviceStore.open(path);
		// A row seen after its registration gets last_seen_at as proof. A row
		// never seen after it (last_seen_at = created_at) stays unproven.
		expect(store.pruneUnprovenOldest(10)).toBe(1);
		expect(store.find("junk-relay-id-01234567")).toBeNull();
		expect(store.find("old-relay-id-0123456789")).not.toBeNull();
		expect(
			store.holdsOldestRegistration(
				"old-relay-id-0123456789",
				"tok-0123456789",
			),
		).toBe(true);
		store.close();
		// A second open finds the column and adds nothing.
		DeviceStore.open(path).close();
	});

	test("a delivered push protects a device from the unproven prune", () => {
		const store = DeviceStore.open(":memory:");
		for (const relayId of [
			"proven-relay-id-0123456",
			"junk-relay-id-01234567",
		]) {
			store.insert({
				relayId,
				platform: "android",
				pushToken: `token-${relayId}`,
				apnsEnvironment: null,
				liveActivityStartToken: null,
				secretHash: "0".repeat(64),
				createdAt: 1,
				updatedAt: 1,
				lastSeenAt: 1,
			});
		}
		store.touch("proven-relay-id-0123456", 5, true);
		expect(store.pruneUnprovenOldest(10)).toBe(1);
		expect(store.find("proven-relay-id-0123456")).not.toBeNull();
		store.close();
	});
});
