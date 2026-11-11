/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	chartRows,
	exportFileName,
	plainCell,
	tableRows,
	toCsv,
	toTsv,
} from "./answer-export.ts";

const body = (csv: string) => csv.slice(1);

describe("plainCell", () => {
	test("strips bold, italic, code and links", () => {
		expect(plainCell("**7.5h** and *x* `y`")).toBe("7.5h and x y");
		expect(plainCell("[Docs](https://example.com/a)")).toBe("Docs");
	});

	test("turns a day link into the date", () => {
		expect(plainCell("[[2026-08-03]]")).toBe("2026-08-03");
	});
});

describe("toCsv", () => {
	test("starts with a BOM and uses CRLF", () => {
		const csv = toCsv([
			["a", "b"],
			["1", "2"],
		]);
		expect(csv.startsWith("﻿")).toBe(true);
		expect(body(csv)).toBe("a,b\r\n1,2\r\n");
	});

	test("quotes commas, quotes and newlines", () => {
		const csv = toCsv([["a,b", 'say "hi"', "x\ny"]]);
		expect(body(csv)).toBe('"a,b","say ""hi""","x\ny"\r\n');
	});

	test("guards a formula but not a negative number", () => {
		const csv = toCsv([["=1+1", "+x", "@a", "-2.5", "-x", "+3"]]);
		expect(body(csv)).toBe("'=1+1,'+x,'@a,-2.5,'-x,+3\r\n");
	});

	test("keeps a negative duration and a signed currency amount", () => {
		const csv = toCsv([
			["-1:30", "-€5", "-$5", "+0:45", "=1:30", "-€x", "-5:"],
		]);
		expect(body(csv)).toBe("-1:30,-€5,-$5,+0:45,'=1:30,'-€x,'-5:\r\n");
	});

	test("writes plain values for markdown cells", () => {
		const csv = toCsv([["[[2026-08-03]]", "**5**"]]);
		expect(body(csv)).toBe("2026-08-03,5\r\n");
	});
});

describe("toTsv", () => {
	test("joins with tabs and flattens inner tabs and newlines", () => {
		expect(
			toTsv([
				["a", "b\tc"],
				["1", "x\ny"],
			]),
		).toBe("a\tb c\n1\tx y");
	});
});

describe("rows and names", () => {
	test("tableRows puts the header first", () => {
		expect(tableRows(["h"], [["r"]])).toEqual([["h"], ["r"]]);
	});

	test("chartRows names the unit", () => {
		const rows = chartRows({
			type: "bar",
			unit: "h",
			data: [{ label: "A", value: 3.5 }],
		});
		expect(rows).toEqual([
			["Label", "Value (h)"],
			["A", "3.5"],
		]);
	});

	test("exportFileName slugs a heading and falls back", () => {
		expect(exportFileName("**Hours** by project!", "x")).toBe(
			"hours-by-project",
		);
		expect(exportFileName(undefined, "farmer-table")).toBe("farmer-table");
		expect(exportFileName("???", "farmer-table")).toBe("farmer-table");
	});
});
