/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import type { TimeReportDetailRow } from "@farmer/core/services";

import {
	DETAILED_CSV_HEADERS,
	detailedCsvRows,
	detailedPdfGroups,
	detailedTruncationNote,
	groupDetailedRows,
	sumSeconds,
} from "./detailed-export.ts";

const row = (over: Partial<TimeReportDetailRow>): TimeReportDetailRow => ({
	id: "e",
	date: "2026-08-01",
	clientId: "c1",
	clientName: "Acme",
	projectId: "p1",
	projectName: "Site",
	projectCode: null,
	taskId: "t1",
	taskName: "Dev",
	description: "",
	userId: "u1",
	userName: "Ana",
	overtime: false,
	durationSeconds: 3600,
	...over,
});

const rows = [
	row({ id: "1", date: "2026-08-03", userId: "u2", userName: "Boris" }),
	row({ id: "2", date: "2026-08-02", durationSeconds: 5400 }),
	row({
		id: "3",
		date: "2026-08-01",
		projectId: "p2",
		projectName: "App",
		projectCode: "APP",
		description: "Fix, then ship",
		overtime: true,
	}),
];

describe("groupDetailedRows", () => {
	test("groups by person, sorted by name, entries by date", () => {
		const groups = groupDetailedRows(rows, "person");
		expect(groups.map((g) => g.label)).toEqual(["Ana", "Boris"]);
		expect(groups[0]?.rows.map((r) => r.id)).toEqual(["3", "2"]);
		expect(groups[0]?.seconds).toBe(5400 + 3600);
	});

	test("groups by project id, labelled with the code", () => {
		const groups = groupDetailedRows(rows, "project");
		expect(groups.map((g) => g.label)).toEqual(["[APP] App", "Site"]);
	});

	test("keeps two people with one name apart", () => {
		const twins = [row({ userId: "a" }), row({ userId: "b" })];
		expect(groupDetailedRows(twins, "person")).toHaveLength(2);
	});
});

describe("detailedCsvRows", () => {
	test("orders by group before date", () => {
		const early = [
			...rows,
			row({ id: "4", date: "2026-07-31", userId: "u2", userName: "Boris" }),
		];
		expect(detailedCsvRows(early, "person").map((r) => r[0])).toEqual([
			"2026-08-01",
			"2026-08-02",
			"2026-07-31",
			"2026-08-03",
		]);
	});

	test("writes one row per entry in group then date order", () => {
		const out = detailedCsvRows(rows, "person");
		expect(out).toHaveLength(3);
		expect(out.map((r) => r[0])).toEqual([
			"2026-08-01",
			"2026-08-02",
			"2026-08-03",
		]);
		expect(out[0]).toHaveLength(DETAILED_CSV_HEADERS.length);
		expect(out[0]).toEqual([
			"2026-08-01",
			"Acme",
			"App",
			"APP",
			"Dev",
			"Fix, then ship",
			"1.00",
			"yes",
			"Ana",
		]);
		expect(out[1]?.[6]).toBe("1.50");
	});

	test("ends a cut result with one marker row", () => {
		const out = detailedCsvRows(rows, "person", { totalRows: 9000 });
		expect(out).toHaveLength(4);
		expect(out[3]?.[0]).toBe(detailedTruncationNote(3, 9000));
		expect(out[3]).toHaveLength(DETAILED_CSV_HEADERS.length);
		expect(out[3]?.[0]).toContain("3 of 9000");
	});

	test("sums the exported rows", () => {
		expect(sumSeconds(rows)).toBe(3600 + 5400 + 3600);
	});
});

describe("detailedPdfGroups", () => {
	test("sets a heading and a subtotal for each group", () => {
		const { columns, groups } = detailedPdfGroups(rows, "project");
		expect(columns.map((c) => c.label)).toEqual([
			"Date",
			"Client",
			"Person",
			"Task",
			"Hours",
		]);
		expect(groups.map((g) => g.heading)).toEqual(["[APP] App", "Site"]);
		expect(groups.map((g) => g.hours)).toEqual(["1,00", "2,50"]);
		expect(groups[0]?.rows[0]?.note).toBe("Fix, then ship · Overtime");
		expect(groups[0]?.rows[0]?.cells[0]).toBe("01/08/2026");
	});
});
