/**
 * The CSV files of the reports. Each builder writes the same headers and
 * cells as the export of the web app (`components/reports/*.tsx` and
 * `lib/csv.ts` there), so a file from the phone and a file from the web
 * open the same in a spreadsheet.
 */

import type {
	OvertimeReport,
	TimeReport,
	TimeReportDetail,
} from "@farmer/api-client";

import { formatDecimalHours } from "./format";
import type { AbsenceViewRow } from "./views";

export type Csv = { headers: string[]; rows: string[][] };

/** A cell that a spreadsheet reads as a formula: =, +, -, @, tab or CR
 *  first (the OWASP list of CSV injection). A person types a description or
 *  a name, and a formula there runs on the computer that opens the file. A
 *  plain number, such as "-1.50", cannot hold a formula, so it stays a
 *  number. */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** A formula cell gets a leading ' and opens as text. Then the quotes of
 *  RFC 4180, only where a cell needs them. */
export const escapeCell = (raw: string) => {
	const value =
		FORMULA_START.test(raw) && !PLAIN_NUMBER.test(raw) ? `'${raw}` : raw;
	return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
};

/** The text of the file. The byte order mark makes Excel read UTF-8, so
 *  the Croatian names stay correct. */
export const toCsv = ({ headers, rows }: Csv) =>
	`﻿${[headers, ...rows]
		.map((row) => row.map(escapeCell).join(","))
		.join("\r\n")}`;

export type TimeTab = "clients" | "projects" | "teammates";

/** The Team tab adds time off to the hours. The other two tabs never see
 *  time off, because it has no client and no project. */
export const rowHours = (
	row: { secondsTotal: number; timeOffSeconds: number },
	tab: TimeTab,
) => row.secondsTotal + (tab === "teammates" ? row.timeOffSeconds : 0);

/** The Time report, one row for each client, project or person. */
export const timeSummaryCsv = (report: TimeReport, tab: TimeTab): Csv => {
	if (tab === "teammates") {
		return {
			headers: ["Person", "Work", "Time-off", "Hours"],
			rows: report.rows.map((row) => [
				row.name,
				formatDecimalHours(row.secondsTotal),
				formatDecimalHours(row.timeOffSeconds),
				formatDecimalHours(rowHours(row, tab)),
			]),
		};
	}
	if (tab === "projects") {
		return {
			headers: ["Project", "Code", "Client", "People", "Hours"],
			rows: report.rows.map((row) => [
				row.name,
				row.code ?? "",
				row.clientName ?? "",
				String(row.count),
				formatDecimalHours(row.secondsTotal),
			]),
		};
	}
	return {
		headers: ["Client", "Projects", "Hours"],
		rows: report.rows.map((row) => [
			row.name,
			String(row.count),
			formatDecimalHours(row.secondsTotal),
		]),
	};
};

/** The entries behind a figure: the drill-down and a project's page. */
export const entriesCsv = (detail: TimeReportDetail): Csv => ({
	headers: [
		"Date",
		"Client",
		"Project",
		"Code",
		"Task",
		"Person",
		"Hours",
		"Overtime",
		"Description",
	],
	rows: detail.rows.map((row) => [
		row.date,
		row.client.name,
		row.project.name,
		row.project.code ?? "",
		row.task.name,
		row.user.name,
		formatDecimalHours(row.durationSeconds),
		row.overtime ? "yes" : "",
		row.description,
	]),
});

export const overtimeCsv = (report: OvertimeReport): Csv => ({
	headers: ["Person", "Entries", "Hours"],
	rows: report.rows.map((row) => [
		row.name,
		String(row.count),
		formatDecimalHours(row.seconds),
	]),
});

/** The Absence report in one view. The days are plain decimals here, as
 *  on the web. */
export const absenceCsv = (
	rows: AbsenceViewRow[],
	workingDaySeconds: number,
): Csv => ({
	headers: ["Person", "Days", "Hours"],
	rows: rows.map((row) => [
		row.name,
		(row.seconds / workingDaySeconds).toFixed(2),
		formatDecimalHours(row.seconds),
	]),
});

/** A name that is safe as a file name: no path separator, no character
 *  that a file system refuses, and no line break. */
export const safeFileName = (name: string) =>
	name
		.replace(/[\\/:*?"<>|]+/g, "-")
		.replace(/\s+/g, " ")
		.trim() || "report";
