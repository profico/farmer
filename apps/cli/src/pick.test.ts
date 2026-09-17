import { describe, expect, test } from "bun:test";

import type { ApiTimeEntry } from "@farmer/core/api";

import type { Output } from "./output";
import { rowNumber, selectEntry } from "./pick";

const out: Output = {
	json: false,
	color: false,
	interactive: false,
	stdoutTty: false,
	columns: null,
};

const entry = (id: string, date: string): ApiTimeEntry => ({
	id,
	date,
	durationSeconds: 3600,
	description: id,
	overtime: false,
	fillsDay: false,
	synced: false,
	commitCount: 0,
	task: { id: "task-1", name: "Development", isAbsence: false },
	project: null,
});

const DAY = "2026-09-14";

const entries = [
	entry("11111111-1111-4111-8111-111111111111", DAY),
	entry("22222222-2222-4222-8222-222222222222", DAY),
	entry("33333333-3333-4333-8333-333333333333", DAY),
];

describe("rowNumber", () => {
	test("one or two digits is a row number", () => {
		expect(rowNumber("3")).toBe(3);
		expect(rowNumber("96")).toBe(96);
	});

	test("anything longer, or not a number, is an id", () => {
		expect(rowNumber("111")).toBeNull();
		expect(rowNumber("0")).toBeNull();
		expect(rowNumber("1a")).toBeNull();
		expect(rowNumber("11111111")).toBeNull();
	});
});

describe("selectEntry", () => {
	test("a row number picks the row the table printed", async () => {
		const picked = await selectEntry(out, entries, "2", DAY, "edit");
		expect(picked.id).toBe("22222222-2222-4222-8222-222222222222");
		expect(picked.entry?.id).toBe(picked.id);
	});

	test("a row number the day does not have says how many it has", async () => {
		expect(selectEntry(out, entries, "7", DAY, "edit")).rejects.toThrow(
			"3 entries",
		);
	});

	test("an id prefix still wins over the numbers", async () => {
		const picked = await selectEntry(out, entries, "33333333", DAY, "rm");
		expect(picked.id).toBe("33333333-3333-4333-8333-333333333333");
	});
});
