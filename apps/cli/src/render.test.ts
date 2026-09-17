import { describe, expect, test } from "bun:test";

import type { ApiTimeEntry } from "@farmer/core/api";

import { entriesTable } from "./render";

const entry = (
	id: string,
	date: string,
	durationSeconds: number,
	description: string,
): ApiTimeEntry => ({
	id,
	date,
	durationSeconds,
	description,
	overtime: false,
	fillsDay: false,
	synced: false,
	commitCount: 0,
	task: { id: "task-1", name: "Development", isAbsence: false },
	project: null,
});

/** The `#` column of every row, the total row left out. */
const numbers = (rows: string[][]) => rows.map((row) => row[0]);

describe("entriesTable", () => {
	test("numbers the rows of one day from 1", () => {
		const table = entriesTable(
			[
				entry("aaaa1111", "2026-09-14", 3600, "First"),
				entry("bbbb2222", "2026-09-14", 1800, "Second"),
			],
			false,
		);
		expect(table.columns[0]).toEqual({ header: "#", align: "right" });
		expect(numbers(table.rows)).toEqual(["1", "2"]);
		expect(table.rows[0]?.[1]).toBe("aaaa1111");
	});

	test("restarts the numbers on each day of a range", () => {
		const table = entriesTable(
			[
				entry("cccc3333", "2026-09-15", 3600, "Monday one"),
				entry("aaaa1111", "2026-09-14", 3600, "Sunday one"),
				entry("dddd4444", "2026-09-15", 3600, "Monday two"),
				entry("bbbb2222", "2026-09-14", 1800, "Sunday two"),
			],
			true,
		);
		// Sorted by day, each day in the order the server answered it.
		expect(table.rows.map((row) => row[1])).toEqual([
			"aaaa1111",
			"bbbb2222",
			"cccc3333",
			"dddd4444",
		]);
		expect(numbers(table.rows)).toEqual(["1", "2", "1", "2"]);
	});

	test("the total row leaves the number column empty", () => {
		const table = entriesTable(
			[entry("aaaa1111", "2026-09-14", 3600, "First")],
			false,
		);
		expect(table.total?.[0]).toBe("");
		expect(table.total?.[1]).toBe("Total");
	});
});
