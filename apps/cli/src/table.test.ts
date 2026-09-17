import { describe, expect, test } from "bun:test";

import { formatTable, type Table } from "./table";

const entries: Table = {
	columns: [
		{ header: "ID" },
		{ header: "Time", align: "right" },
		{ header: "Description", shrink: true },
	],
	rows: [
		["a1", "1:30", "Fix login"],
		["b2", "10:00", "Review"],
	],
	total: ["Total", "11:30", "2 entries"],
};

describe("formatTable", () => {
	test("aligns columns and puts the total under a rule", () => {
		expect(formatTable(entries, null)).toEqual([
			"ID      Time  Description",
			"a1      1:30  Fix login",
			"b2     10:00  Review",
			"-------------------------",
			"Total  11:30  2 entries",
		]);
	});

	test("a table with no total has no rule", () => {
		const lines = formatTable({ ...entries, total: null }, null);
		expect(lines).toHaveLength(3);
		expect(lines.some((line) => line.startsWith("-"))).toBe(false);
	});

	test("a narrow terminal shortens the shrinking column only", () => {
		const long: Table = {
			...entries,
			rows: [["a1", "1:30", "A very long description of the work"]],
		};

		const lines = formatTable(long, 30);
		expect(lines[1]).toBe("a1      1:30  A very long des…");

		for (const line of lines) {
			expect(Bun.stringWidth(line)).toBeLessThanOrEqual(30);
		}
	});

	test("a pipe gets the whole description", () => {
		const long: Table = {
			...entries,
			rows: [["a1", "1:30", "A very long description of the work"]],
		};

		expect(formatTable(long, null)[1]).toEndWith(
			"A very long description of the work",
		);
	});
});
