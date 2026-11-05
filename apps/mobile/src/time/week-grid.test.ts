import { describe, expect, test } from "bun:test";

/// <reference types="bun-types" />
import type { TimeEntry } from "@farmer/api-client";

import {
	buildRows,
	cellSeconds,
	type DraftRow,
	notePatches,
	planCellWrite,
	rowDeletions,
	rowKey,
	rowSeconds,
	stepCell,
} from "./week-grid";

const H = 3600;
const MON = "2026-10-05";
const TUE = "2026-10-06";

let next = 0;
const entry = (fields: {
	date?: string;
	hours?: number;
	project?: string | null;
	task?: string;
	description?: string;
	fillsDay?: boolean;
	isAbsence?: boolean;
}): TimeEntry => {
	next += 1;
	const project = fields.project === undefined ? "Atlas" : fields.project;
	return {
		id: `e${next}`,
		date: fields.date ?? MON,
		durationSeconds: (fields.hours ?? 1) * H,
		description: fields.description ?? "",
		overtime: false,
		fillsDay: fields.fillsDay ?? false,
		synced: false,
		commitCount: 0,
		task: {
			id: fields.task ?? "dev",
			name: fields.task ?? "dev",
			isAbsence: fields.isAbsence ?? false,
		},
		project: project
			? {
					id: project,
					name: project,
					code: null,
					client: { id: "c", name: "Client" },
				}
			: null,
	};
};

describe("the rows of a week", () => {
	test("one row for each project and task, with its days", () => {
		const rows = buildRows(
			[
				entry({ date: MON, hours: 2 }),
				entry({ date: TUE, hours: 3 }),
				entry({ date: MON, task: "review" }),
				entry({ project: null, task: "Vacation", isAbsence: true, hours: 8 }),
			],
			[],
		);
		expect(rows.map((row) => row.key)).toEqual([
			rowKey("Atlas", "dev"),
			rowKey("Atlas", "review"),
			rowKey(null, "Vacation"),
		]);
		const [atlas] = rows;
		expect(atlas && cellSeconds(atlas, MON)).toBe(2 * H);
		expect(atlas && rowSeconds(atlas, [MON, TUE])).toBe(5 * H);
		expect(rows[2]?.heading).toBe("Vacation");
		expect(rows[2]?.taskName).toBe("");
	});

	test("a rest-of-day block locks its row", () => {
		const rows = buildRows([entry({ fillsDay: true }), entry({})], []);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.locked).toBe(true);
	});

	test("an added row shows until it has entries, and only once", () => {
		const draft: DraftRow = {
			key: rowKey("Atlas", "dev"),
			projectId: "Atlas",
			taskId: "dev",
			heading: "Atlas",
			taskName: "dev",
			isAbsence: false,
		};
		expect(buildRows([], [draft])).toHaveLength(1);
		expect(buildRows([entry({})], [draft])).toHaveLength(1);
	});
});

describe("a step of a cell", () => {
	test("moves 15 minutes and can reach zero", () => {
		expect(stepCell(H, 1, H)).toBe(H + 900);
		expect(stepCell(900, -1, 900)).toBe(0);
		expect(stepCell(0, -1, 0)).toBe(0);
	});

	test("stops where the day holds 24 hours", () => {
		expect(stepCell(H, 1, 24 * H)).toBe(H);
		expect(stepCell(0, 1, 23.75 * H)).toBe(900);
		expect(stepCell(0, 2, 23.75 * H)).toBe(900);
	});
});

describe("the write of a cell", () => {
	test("an empty cell gets a new entry", () => {
		expect(planCellWrite([], 2 * H)).toEqual({
			kind: "create",
			durationSeconds: 2 * H,
		});
	});

	test("zero deletes every entry of the cell, and nothing in an empty one", () => {
		const a = entry({});
		const b = entry({});
		expect(planCellWrite([a, b], 0)).toEqual({
			kind: "delete",
			ids: [a.id, b.id],
		});
		expect(planCellWrite([], 0)).toEqual({ kind: "none" });
	});

	test("a filled cell changes its first entry and takes the others out", () => {
		const a = entry({});
		const b = entry({});
		expect(planCellWrite([a, b], 3 * H)).toEqual({
			kind: "update",
			id: a.id,
			durationSeconds: 3 * H,
			deleteIds: [b.id],
		});
	});

	test("the same figure writes nothing", () => {
		expect(planCellWrite([entry({ hours: 2 })], 2 * H)).toEqual({
			kind: "none",
		});
	});

	test("a rest-of-day block is never part of the write", () => {
		expect(planCellWrite([entry({ fillsDay: true })], 2 * H)).toEqual({
			kind: "create",
			durationSeconds: 2 * H,
		});
	});
});

describe("the notes of a row", () => {
	test("a day's note goes onto each of that day's entries that differ", () => {
		const a = entry({ description: "Old" });
		const b = entry({ description: "" });
		const [row] = buildRows([a, b, entry({ date: TUE })], []);
		expect(row && notePatches(row, MON, " New ")).toEqual([
			{ id: a.id, description: "New" },
			{ id: b.id, description: "New" },
		]);
		expect(row && notePatches(row, MON, "Old")).toEqual([]);
	});

	test("a row is deleted day by day", () => {
		const a = entry({ date: MON });
		const b = entry({ date: MON });
		const c = entry({ date: TUE });
		const [row] = buildRows([a, b, c], []);
		expect(row && rowDeletions(row)).toEqual([[a.id, b.id], [c.id]]);
	});
});
