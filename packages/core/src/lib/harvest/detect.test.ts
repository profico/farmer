import { describe, expect, test } from "bun:test";

import { at } from "../../test/harness";
import { iterateCsvRecords } from "./csv";
import {
	detectHarvestFile,
	parseHarvestDate,
	toClientRow,
	toPeopleRow,
	toProjectRow,
	toTaskRow,
	toTimeReportRow,
} from "./detect";

// Headers copied verbatim from the real exports in ~/Downloads/harvest
// (2026-09-11), so detection is pinned to what Harvest actually produces.
const TIME_REPORT_HEADER = [
	"Date",
	"Client",
	"Project",
	"Project Code",
	"Task",
	"Notes",
	"Hours",
	"Billable?",
	"Invoiced?",
	"Approved?",
	"First Name",
	"Last Name",
	"Employee Id",
	"Roles",
	"Teams",
	"Employee?",
	"Billable Rate",
	"Billable Amount",
	"Cost Rate",
	"Cost Amount",
	"Currency",
	"External Reference URL",
];

const PEOPLE_HEADER = [
	"First Name",
	"Last Name",
	"Email",
	"Employee Id",
	"Roles",
	"Billable Rate",
	"Cost Rate",
	"Admin",
	"Permissions",
	"Employee",
	"Capacity",
];

const PROJECTS_HEADER = [
	"Client",
	"Project",
	"Project Code",
	"Start Date",
	"End Date",
	"Project Notes",
	"Total Hours",
	"Billable Hours",
	"Billable Amount",
	"Budget By",
	"Budget",
	"Budget Spent",
	"Budget Remaining",
	"Total Costs",
	"Team Costs",
	"Expenses",
	"Invoiced Amount",
];

const TASKS_HEADER = ["Task name", "Billable rate", "Billable", "Active?"];

const CLIENTS_HEADER = ["Client Name", "Address"];

describe("detectHarvestFile", () => {
	test("time_report", () => {
		expect(detectHarvestFile(TIME_REPORT_HEADER).kind).toBe("time_report");
	});

	test("people", () => {
		expect(detectHarvestFile(PEOPLE_HEADER).kind).toBe("people");
	});

	test("projects", () => {
		expect(detectHarvestFile(PROJECTS_HEADER).kind).toBe("projects");
	});

	test("tasks", () => {
		expect(detectHarvestFile(TASKS_HEADER).kind).toBe("tasks");
	});

	test("clients", () => {
		expect(detectHarvestFile(CLIENTS_HEADER).kind).toBe("clients");
	});

	test("an unrelated header is unknown, with a reason", () => {
		const result = detectHarvestFile(["Foo", "Bar"]);
		expect(result.kind).toBe("unknown");
		expect(result.reason.length).toBeGreaterThan(0);
	});

	test("column reordering does not change the kind", () => {
		const shuffled = [...PROJECTS_HEADER].reverse();
		expect(detectHarvestFile(shuffled).kind).toBe("projects");
	});

	test("an extra unknown column is tolerated", () => {
		const withExtra = [...TASKS_HEADER, "Some New Column"];
		expect(detectHarvestFile(withExtra).kind).toBe("tasks");
	});

	test("a header missing one required column for every kind is unknown", () => {
		const brokenTasks = TASKS_HEADER.filter((c) => c !== "Active?");
		expect(detectHarvestFile(brokenTasks).kind).toBe("unknown");
	});
});

describe("parseHarvestDate", () => {
	test("ISO date, already zero-padded", () => {
		expect(parseHarvestDate("2014-12-30")).toBe("2014-12-30");
	});

	test("empty is null", () => {
		expect(parseHarvestDate("")).toBeNull();
	});

	test("garbage is null", () => {
		expect(parseHarvestDate("not a date")).toBeNull();
	});
});

// Harvest quotes any field holding a comma, e.g. the "0,5" hours value —
// this mirrors that so the fixture rows below are valid CSV.
function csvField(value: string): string {
	return value.includes(",") ? `"${value}"` : value;
}

function recordsFor(
	header: string[],
	rows: string[][],
): ReadonlyMap<string, string>[] {
	const line = (cells: string[]) => cells.map(csvField).join(",");
	const text = `${line(header)}\n${rows.map(line).join("\n")}\n`;
	return Array.from(iterateCsvRecords(text));
}

describe("typed row accessors", () => {
	test("toTimeReportRow reads a real-shaped row", () => {
		const records = recordsFor(TIME_REPORT_HEADER, [
			[
				"2014-12-30",
				"Profico",
				"Internal",
				"PRINT",
				"Admin",
				"a note",
				"0,5",
				"No",
				"No",
				"No",
				"Probo",
				"Testić",
				"",
				"Administration|Product management",
				"",
				"Yes",
				"0,0",
				"0,0",
				"0,0",
				"0,0",
				"United States Dollar - USD",
				"",
			],
		]);
		const row = toTimeReportRow(at(records, 0));
		expect(row.date).toBe("2014-12-30");
		expect(row.client).toBe("Profico");
		expect(row.project).toBe("Internal");
		expect(row.projectCode).toBe("PRINT");
		expect(row.task).toBe("Admin");
		expect(row.notes).toBe("a note");
		expect(row.hours).toBeCloseTo(0.5);
		expect(row.billable).toBe(false);
		expect(row.firstName).toBe("Probo");
		expect(row.lastName).toBe("Testić");
		expect(row.employee).toBe(true);
	});

	test("toPeopleRow reads a real-shaped row", () => {
		const records = recordsFor(PEOPLE_HEADER, [
			[
				"Probo",
				"Testić",
				"probo@example.com",
				"",
				"Administration|Product management",
				"0.0",
				"",
				"Yes",
				"Owner",
				"Yes",
				"40.0",
			],
		]);
		const row = toPeopleRow(at(records, 0));
		expect(row.firstName).toBe("Probo");
		expect(row.email).toBe("probo@example.com");
		expect(row.admin).toBe(true);
		expect(row.employee).toBe(true);
	});

	test("toProjectRow reads a real-shaped row", () => {
		const records = recordsFor(PROJECTS_HEADER, [
			[
				"ABC Startsiden AS",
				"MeeTV",
				"ABC_MTv",
				"2016-06-01",
				"",
				"",
				"10.773,68",
				"0,0",
				"0,0",
				"",
				"",
				"",
				"",
				"0,0",
				"0,0",
				"0,0",
				"0",
			],
		]);
		const row = toProjectRow(at(records, 0));
		expect(row.client).toBe("ABC Startsiden AS");
		expect(row.name).toBe("MeeTV");
		expect(row.code).toBe("ABC_MTv");
		expect(row.startDate).toBe("2016-06-01");
		expect(row.endDate).toBeNull();
		expect(row.totalHours).toBeCloseTo(10773.68);
	});

	test("toTaskRow reads a real-shaped row", () => {
		const records = recordsFor(TASKS_HEADER, [["Admin", "", "No", "No"]]);
		const row = toTaskRow(at(records, 0));
		expect(row.name).toBe("Admin");
		expect(row.billable).toBe(false);
		expect(row.active).toBe(false);
	});

	test("toClientRow reads a real-shaped row", () => {
		const records = recordsFor(CLIENTS_HEADER, [["Profico", ""]]);
		const row = toClientRow(at(records, 0));
		expect(row.name).toBe("Profico");
	});
});
