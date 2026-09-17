import { describe, expect, test } from "bun:test";

import { iterateCsv, parseCsv, readCsvHeader } from "./csv";

describe("parseCsv", () => {
	test("a plain grid", () => {
		expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
			["a", "b", "c"],
			["1", "2", "3"],
		]);
	});

	test("no trailing newline on the last row", () => {
		expect(parseCsv("a,b\n1,2")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
	});

	test("a trailing newline produces no extra empty row", () => {
		expect(parseCsv("a,b\n1,2\n")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
	});

	test("CRLF row endings", () => {
		expect(parseCsv("a,b\r\n1,2\r\n3,4")).toEqual([
			["a", "b"],
			["1", "2"],
			["3", "4"],
		]);
	});

	test("bare LF and CRLF mixed in the same file", () => {
		expect(parseCsv("a,b\r\n1,2\n3,4")).toEqual([
			["a", "b"],
			["1", "2"],
			["3", "4"],
		]);
	});

	test("a leading UTF-8 BOM is stripped", () => {
		expect(parseCsv("﻿a,b\n1,2\n")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
	});

	test("empty fields", () => {
		expect(parseCsv("a,,c\n,,\n")).toEqual([
			["a", "", "c"],
			["", "", ""],
		]);
	});

	test("empty input yields no rows", () => {
		expect(parseCsv("")).toEqual([]);
	});

	test("a quoted field", () => {
		expect(parseCsv('a,"b,c",d\n')).toEqual([["a", "b,c", "d"]]);
	});

	test('a doubled quote ("") inside a quoted field is one literal quote', () => {
		expect(parseCsv('"She said ""hi""",b\n')).toEqual([['She said "hi"', "b"]]);
	});

	test("a line break inside a quoted field is kept as content", () => {
		expect(parseCsv('a,"line one\nline two",c\n')).toEqual([
			["a", "line one\nline two", "c"],
		]);
	});

	test("a CRLF inside a quoted field is kept as content", () => {
		expect(parseCsv('a,"line one\r\nline two",c\n')).toEqual([
			["a", "line one\r\nline two", "c"],
		]);
	});

	test("a quoted field that is otherwise empty", () => {
		expect(parseCsv('a,"",c\n')).toEqual([["a", "", "c"]]);
	});

	test("a quoted field holding a comma and a newline together", () => {
		const text =
			'Date,Notes,Hours\n2014-12-30,"line one, still one\nline two","0,5"\n';

		expect(parseCsv(text)).toEqual([
			["Date", "Notes", "Hours"],
			["2014-12-30", "line one, still one\nline two", "0,5"],
		]);
	});

	test("an unterminated quote at end of file is not an infinite loop", () => {
		expect(parseCsv('a,"b')).toEqual([["a", "b"]]);
	});
});

describe("iterateCsv", () => {
	test("yields the same rows as parseCsv, lazily", () => {
		const text = "a,b\n1,2\n3,4\n";
		expect(Array.from(iterateCsv(text))).toEqual(parseCsv(text));
	});

	test("reading only the header does not require the rest of the text to be well-formed", () => {
		const it = iterateCsv('a,b,c\n1,"unterminated');
		expect(it.next().value).toEqual(["a", "b", "c"]);
	});
});

describe("readCsvHeader", () => {
	test("reads just the first row", () => {
		expect(readCsvHeader("a,b,c\n1,2,3\n4,5,6\n")).toEqual(["a", "b", "c"]);
	});

	test("empty input has an empty header", () => {
		expect(readCsvHeader("")).toEqual([]);
	});

	test("strips a leading BOM before reading the header", () => {
		expect(readCsvHeader("﻿a,b\n1,2\n")).toEqual(["a", "b"]);
	});
});
