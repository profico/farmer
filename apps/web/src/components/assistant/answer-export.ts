// Pure helpers that turn a parsed table or chart into CSV or TSV text.
// The input is the output of `parseBlocks`, never the DOM.

import type { ChartSpec } from "./answer-chart.tsx";

const BOM = "﻿";

/** The text of a cell without its inline markdown. A `[[date]]` becomes the
 *  date, a link becomes its label. */
export const plainCell = (cell: string) =>
	cell
		.replace(/\[\[(\d{4}-\d{2}-\d{2})\]\]/g, "$1")
		.replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*\n]+)\*/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.trim();

const isPlainNumber = (value: string) => /^[-+]?[\d.,]*\d%?$/.test(value);

/** A spreadsheet runs a cell that starts with one of these as a formula. A
 *  plain number, such as `-2.5`, stays as it is. */
const guardFormula = (value: string) =>
	/^[=+\-@]/.test(value) && !isPlainNumber(value) ? `'${value}` : value;

const cleanRow = (row: string[]) =>
	row.map((cell) => guardFormula(plainCell(cell)));

const quote = (field: string) =>
	/[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;

/** RFC 4180: CRLF line ends, and a BOM so Excel reads UTF-8. */
export const toCsv = (rows: string[][]) =>
	BOM +
	rows.map((row) => cleanRow(row).map(quote).join(",")).join("\r\n") +
	"\r\n";

/** Tab-separated text for a paste into a spreadsheet. */
export const toTsv = (rows: string[][]) =>
	rows
		.map((row) =>
			cleanRow(row)
				.map((field) => field.replace(/[\t\r\n]+/g, " "))
				.join("\t"),
		)
		.join("\n");

/** The header and the body of a table as one list of rows. */
export const tableRows = (head: string[], rows: string[][]) => [head, ...rows];

/** The rows of a chart: a label column and a value column. */
export const chartRows = (spec: ChartSpec) => [
	["Label", spec.unit ? `Value (${spec.unit})` : "Value"],
	...spec.data.map((point) => [point.label, String(point.value)]),
];

/** A safe file name from a heading, or the fallback. */
export const exportFileName = (title: string | undefined, fallback: string) => {
	const slug = plainCell(title ?? "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	return slug || fallback;
};
