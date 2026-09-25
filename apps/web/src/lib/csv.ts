/**
 * CSV export (PRD 6.1). Built in the browser from data already on screen rather
 * than as an endpoint: the detailed report is the only thing exportable, the
 * rows are already loaded, and a download route would have to re-resolve scope
 * and re-run the query to produce the same bytes.
 */

/** A cell a spreadsheet would read as a formula: =, +, -, @, tab or CR first
 *  (OWASP's CSV injection list). A description, a name or a task title is
 *  typed by a member, and =HYPERLINK(...) there would run on whoever opens
 *  the export. A plain number such as a negative "-1.50" hours is exempt: it
 *  can't hold a formula, and the prefix would turn it into text. */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** A formula-like cell gets a leading ' so it opens as text. Then RFC 4180
 *  quoting, applied only where it's needed so the common case reads as plain
 *  text in a diff or a terminal. */
const escapeCell = (raw: string): string => {
	const value =
		FORMULA_START.test(raw) && !PLAIN_NUMBER.test(raw) ? `'${raw}` : raw;
	return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
};

export function toCsv(headers: string[], rows: string[][]): string {
	return [headers, ...rows]
		.map((row) => row.map(escapeCell).join(","))
		.join("\r\n");
}

export function downloadCsv(
	filename: string,
	headers: string[],
	rows: string[][],
): void {
	// The BOM is what makes Excel read the file as UTF-8 rather than as the local
	// codepage — without it Croatian names come out mangled, which is exactly the
	// audience for this button.
	const blob = new Blob([`﻿${toCsv(headers, rows)}`], {
		type: "text/csv;charset=utf-8",
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}
