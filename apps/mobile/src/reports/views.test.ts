/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	bucketHours,
	type DetailRow,
	entryMatches,
	groupEntries,
} from "./views";

const row = (
	id: string,
	date: string,
	user: string,
	seconds: number,
	project = "p1",
): DetailRow => ({
	id,
	date,
	client: { id: "c1", name: "Acme" },
	project: { id: project, name: project === "p1" ? "Site" : "App", code: null },
	task: { id: "t1", name: "Development" },
	description: id === "a" ? "Login page" : "",
	user: { id: user, name: user === "u1" ? "Ana" : "Ivo" },
	overtime: false,
	durationSeconds: seconds,
});

const rows = [
	row("a", "2026-10-02", "u1", 3600),
	row("b", "2026-10-01", "u2", 7200),
	row("c", "2026-10-01", "u1", 1800, "p2"),
];

describe("the groups of a drill-down", () => {
	test("people by id, the most hours first, the entries by date", () => {
		const groups = groupEntries(rows, "teammate");
		expect(groups.map((group) => [group.label, group.seconds])).toEqual([
			["Ivo", 7200],
			["Ana", 5400],
		]);
		expect(groups[1]?.rows.map((entry) => entry.id)).toEqual(["c", "a"]);
	});

	test("dates are in order and count their people", () => {
		const groups = groupEntries(rows, "date");
		expect(groups.map((group) => group.key)).toEqual([
			"2026-10-01",
			"2026-10-02",
		]);
		expect(groups[0]?.people).toBe(2);
		expect(groups[0]?.label).toBe("Thu, 1 Oct");
	});

	test("a search looks in the names and the description", () => {
		expect(rows.filter((entry) => entryMatches(entry, "login"))).toHaveLength(
			1,
		);
		expect(rows.filter((entry) => entryMatches(entry, "app"))).toHaveLength(1);
		expect(rows.filter((entry) => entryMatches(entry, " "))).toHaveLength(3);
	});
});

describe("the bars of a chart", () => {
	test("a month has a bar for each day, with the empty days", () => {
		const bars = bucketHours(rows, "2026-10-01", "2026-10-31");
		expect(bars).toHaveLength(31);
		expect(bars[0]).toEqual({ key: "2026-10-01", label: "1", seconds: 9000 });
		expect(bars[2]?.seconds).toBe(0);
	});

	test("a longer range has a bar for each month", () => {
		const bars = bucketHours(rows, "2026-01-31", "2026-03-05");
		expect(bars.map((bar) => bar.key)).toEqual([
			"2026-01",
			"2026-02",
			"2026-03",
		]);
		const year = bucketHours(rows, "2026-01-01", "2026-12-31");
		expect(year).toHaveLength(12);
		expect(year[9]).toEqual({ key: "2026-10", label: "Oct", seconds: 12600 });
	});
});
