// The projection is the whole reason `packages/core/src/api` exists: a column
// added to `time_entry` next month must not become a field that an installed
// CLI binary, or somebody's script on top of `--json`, starts to depend on. So
// these tests hand the projection a row with more than it asked for and check
// that the extra fields do not come out the other side.

import { describe, expect, test } from "bun:test";

import { toApiTimeEntry, toApiUnfiledEntry } from "./time-entries";

const createdAt = new Date("2026-09-14T08:00:00Z");

/** A row shaped like `listRange`'s: every column plus its joins, and more. */
const fullRow = () => ({
	id: "e-1",
	organizationId: "org-1",
	userId: "u-1",
	date: "2026-09-14",
	durationSeconds: 5400,
	description: "Fix login",
	overtime: false,
	fillsDay: false,
	syncLocked: true,
	meetingUrl: "https://meet.example.com/abc",
	calendarEventId: "evt-1",
	createdAt,
	updatedAt: createdAt,
	commitCount: 3,
	taskId: "t-1",
	projectId: "p-1",
	task: {
		id: "t-1",
		name: "Development",
		isAbsence: false,
		scope: "site",
		systemKey: "development",
		archivedAt: null,
	},
	project: {
		id: "p-1",
		name: "Portal",
		code: "PRT",
		budgetHours: 400,
		hourlyRate: 95,
		clientId: "c-1",
		client: { id: "c-1", name: "Acme", organizationId: "org-1" },
	},
});

describe("toApiTimeEntry", () => {
	test("keeps exactly the fields it names, at every level", () => {
		expect(toApiTimeEntry(fullRow())).toStrictEqual({
			id: "e-1",
			date: "2026-09-14",
			durationSeconds: 5400,
			description: "Fix login",
			overtime: false,
			fillsDay: false,
			synced: true,
			commitCount: 3,
			task: { id: "t-1", name: "Development", isAbsence: false },
			project: {
				id: "p-1",
				name: "Portal",
				code: "PRT",
				client: { id: "c-1", name: "Acme" },
			},
		});
	});

	// Belt to the assertion above: `toStrictEqual` already fails on an extra
	// key, but naming the dropped ones says which leaks this guards against.
	test("drops the row's bookkeeping and the project's money", () => {
		const projected = toApiTimeEntry(fullRow());

		for (const key of [
			"organizationId",
			"userId",
			"syncLocked",
			"meetingUrl",
			"calendarEventId",
			"createdAt",
			"taskId",
			"projectId",
		]) {
			expect(Object.keys(projected)).not.toContain(key);
		}

		expect(Object.keys(projected.project ?? {})).not.toContain("hourlyRate");
		expect(Object.keys(projected.project ?? {})).not.toContain("budgetHours");
	});

	test("reads an unsynced, unfiled row with no commit count", () => {
		const row = {
			...fullRow(),
			calendarEventId: null,
			project: null,
			commitCount: undefined,
		};

		const projected = toApiTimeEntry(row);
		expect(projected.synced).toBe(false);
		expect(projected.project).toBe(null);
		expect(projected.commitCount).toBe(0);
	});
});

describe("toApiUnfiledEntry", () => {
	test("keeps exactly the fields it names", () => {
		const row = {
			id: "e-2",
			date: "2026-09-13",
			durationSeconds: 1800,
			description: "Stand-up",
			taskId: "t-2",
			taskName: "Meeting",
			meetingUrl: null,
			userId: "u-1",
		};

		expect(toApiUnfiledEntry(row)).toStrictEqual({
			id: "e-2",
			date: "2026-09-13",
			durationSeconds: 1800,
			description: "Stand-up",
			task: { id: "t-2", name: "Meeting" },
			meetingUrl: null,
		});
	});
});
