import { describe, expect, test } from "bun:test";

/// <reference types="bun-types" />
import type {
	AbsenceReport,
	OvertimeReport,
	TimeReport,
	TimeReportDetail,
} from "@farmer/api-client";

import {
	absenceCsv,
	entriesCsv,
	escapeCell,
	overtimeCsv,
	safeFileName,
	timeSummaryCsv,
	toCsv,
} from "./csv";
import {
	formatCount,
	formatDecimalHours,
	formatReportDays,
	formatReportHours,
} from "./format";
import { absenceView } from "./views";

const HOUR = 3600;

describe("the numbers of a report", () => {
	test("hours as the accounting book writes them", () => {
		expect(formatReportHours(0)).toBe("0,00");
		expect(formatReportHours(7.5 * HOUR)).toBe("7,50");
		expect(formatReportHours(6557.5 * HOUR)).toBe("6.557,50");
		expect(formatReportHours(1_234_567 * HOUR)).toBe("1.234.567,00");
		expect(formatReportHours(-1.25 * HOUR)).toBe("-1,25");
		expect(formatReportHours(-1)).toBe("0,00");
	});

	test("decimal hours for a file, and the days of an absence", () => {
		expect(formatDecimalHours(5400)).toBe("1.50");
		expect(formatReportDays(12 * HOUR, 8 * HOUR)).toBe("1,50");
		expect(formatReportDays(HOUR, 0)).toBe("-");
		expect(formatCount(1204)).toBe("1.204");
	});
});

describe("a CSV file", () => {
	test("a formula opens as text, and a plain number stays a number", () => {
		expect(escapeCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
		expect(escapeCell("@sum")).toBe("'@sum");
		expect(escapeCell("-1.50")).toBe("-1.50");
		expect(escapeCell("- a note")).toBe("'- a note");
	});

	test("RFC 4180 quotes only where a cell needs them", () => {
		expect(escapeCell("plain")).toBe("plain");
		expect(escapeCell('say "hi", then')).toBe('"say ""hi"", then"');
		expect(escapeCell("two\nlines")).toBe('"two\nlines"');
	});

	test("the file has a byte order mark and CRLF line ends", () => {
		expect(toCsv({ headers: ["A", "B"], rows: [["1", "x,y"]] })).toBe(
			'﻿A,B\r\n1,"x,y"',
		);
	});

	test("a file name has no path separator", () => {
		expect(safeFileName("R&D / Ops: 2026")).toBe("R&D - Ops- 2026");
		expect(safeFileName("  ")).toBe("report");
	});
});

const summary: TimeReport = {
	rows: [
		{
			id: "p1",
			name: "Site",
			secondsTotal: 9000,
			timeOffSeconds: 3600,
			count: 2,
			clientName: "Acme",
			code: "ST",
			archived: false,
		},
	],
	totalSeconds: 9000,
	unfiledSeconds: 0,
};

describe("the files of the reports, as the web writes them", () => {
	test("the Time report has the columns of its tab", () => {
		expect(timeSummaryCsv(summary, "projects")).toEqual({
			headers: ["Project", "Code", "Client", "People", "Hours"],
			rows: [["Site", "ST", "Acme", "2", "2.50"]],
		});
		expect(timeSummaryCsv(summary, "clients")).toEqual({
			headers: ["Client", "Projects", "Hours"],
			rows: [["Site", "2", "2.50"]],
		});
		// Only the Team tab adds the time off.
		expect(timeSummaryCsv(summary, "teammates")).toEqual({
			headers: ["Person", "Work", "Time-off", "Hours"],
			rows: [["Site", "2.50", "1.00", "3.50"]],
		});
	});

	test("the entries have nine columns", () => {
		const detail: TimeReportDetail = {
			rows: [
				{
					id: "e1",
					date: "2026-10-05",
					client: { id: "c1", name: "Acme" },
					project: { id: "p1", name: "Site", code: null },
					task: { id: "t1", name: "Development" },
					description: "=cmd",
					user: { id: "u1", name: "Ana" },
					overtime: true,
					durationSeconds: 2700,
				},
			],
			totalRows: 1,
			totalSeconds: 2700,
			truncated: false,
		};
		const csv = entriesCsv(detail);
		expect(csv.headers).toEqual([
			"Date",
			"Client",
			"Project",
			"Code",
			"Task",
			"Person",
			"Hours",
			"Overtime",
			"Description",
		]);
		expect(csv.rows).toEqual([
			[
				"2026-10-05",
				"Acme",
				"Site",
				"",
				"Development",
				"Ana",
				"0.75",
				"yes",
				"=cmd",
			],
		]);
		expect(toCsv(csv).endsWith(",0.75,yes,'=cmd")).toBe(true);
	});

	test("overtime has a row for each person", () => {
		const report: OvertimeReport = {
			rows: [
				{ userId: "u1", name: "Ana", count: 3, seconds: 10800, entries: [] },
			],
			totalSeconds: 10800,
			totalEntries: 3,
		};
		expect(overtimeCsv(report)).toEqual({
			headers: ["Person", "Entries", "Hours"],
			rows: [["Ana", "3", "3.00"]],
		});
	});

	test("an absence view counts only its kinds, in plain days", () => {
		const report: AbsenceReport = {
			workingDaySeconds: 8 * HOUR,
			columns: [
				{ key: "vacation", label: "Vacation" },
				{ key: "sick", label: "Sick" },
			],
			rows: [
				{
					userId: "u1",
					name: "Ana",
					seconds: 20 * HOUR,
					byTask: {},
					entries: [
						{
							id: "a",
							date: "2026-10-01",
							taskKey: "vacation",
							taskName: "Vacation",
							description: "",
							durationSeconds: 16 * HOUR,
						},
						{
							id: "b",
							date: "2026-10-02",
							taskKey: "sick",
							taskName: "Sick",
							description: "",
							durationSeconds: 4 * HOUR,
						},
					],
				},
			],
		};
		expect(absenceCsv(absenceView(report, "all"), 8 * HOUR).rows).toEqual([
			["Ana", "2.50", "20.00"],
		]);
		expect(absenceCsv(absenceView(report, "other"), 8 * HOUR).rows).toEqual([
			["Ana", "0.50", "4.00"],
		]);
		expect(absenceView(report, "paid")).toEqual([]);
	});
});
