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
		expect(
			syncMessage(result({ ran: ["recurring-blocks", "meetings"] })),
		).toEqual({
			message: "Synced recurring blocks, calendar meetings.",
			warning: false,
		});
		expect(
			syncMessage(result({ ran: ["meetings"], failed: ["commit-work-time"] })),
		).toEqual({
			message: "The sync failed for GitHub work time.",
			warning: true,
		});
	});

	test("a step that the app does not know keeps its name, without hyphens", () => {
		expect(syncMessage(result({ ran: ["new-step"] })).message).toBe(
			"Synced new step.",
		);
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
