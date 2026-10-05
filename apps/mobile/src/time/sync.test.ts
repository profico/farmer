/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { syncMessage } from "./sync";

const result = (fields: Partial<Parameters<typeof syncMessage>[0]>) => ({
	stillRunning: false,
	ran: [],
	skipped: [],
	failed: [],
	off: [],
	...fields,
});

describe("sync now", () => {
	test("names what ran, and warns about what failed", () => {
		expect(syncMessage(result({ ran: ["calendar", "github"] }))).toEqual({
			message: "Synced calendar, github.",
			warning: false,
		});
		expect(
			syncMessage(result({ ran: ["calendar"], failed: ["github"] })),
		).toEqual({ message: "The sync failed for github.", warning: true });
	});

	test("a sync that continues on the server, or has nothing to run, says so", () => {
		expect(syncMessage(result({ stillRunning: true })).message).toContain(
			"continues on the server",
		);
		expect(syncMessage(result({ off: ["calendar"] })).message).toBe(
			"Nothing to sync. Connect a calendar or GitHub first.",
		);
	});
});
