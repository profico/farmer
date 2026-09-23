/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { acceptsGzip } from "./accept-encoding.ts";

describe("acceptsGzip", () => {
	test("a plain gzip entry admits gzip", () => {
		expect(acceptsGzip("gzip")).toBe(true);
		expect(acceptsGzip("gzip, deflate, br, zstd")).toBe(true);
		expect(acceptsGzip("br;q=1.0, GZIP;q=0.5")).toBe(true);
		expect(acceptsGzip("x-gzip")).toBe(true);
	});

	test("a zero weight refuses gzip", () => {
		expect(acceptsGzip("gzip;q=0")).toBe(false);
		expect(acceptsGzip("gzip; q=0.000, br")).toBe(false);
		expect(acceptsGzip("br, gzip;q=0")).toBe(false);
	});

	test("a listed gzip decides, whatever the wildcard says", () => {
		expect(acceptsGzip("*, gzip;q=0")).toBe(false);
		expect(acceptsGzip("*;q=0, gzip")).toBe(true);
	});

	test("the wildcard admits gzip when gzip is not listed", () => {
		expect(acceptsGzip("*")).toBe(true);
		expect(acceptsGzip("br, *;q=0.1")).toBe(true);
		expect(acceptsGzip("br, *;q=0")).toBe(false);
	});

	test("no header, an empty one or an unrelated list admits nothing", () => {
		expect(acceptsGzip(null)).toBe(false);
		expect(acceptsGzip(undefined)).toBe(false);
		expect(acceptsGzip("")).toBe(false);
		expect(acceptsGzip("identity")).toBe(false);
		expect(acceptsGzip("br, deflate")).toBe(false);
	});

	test("a substring of another coding is not gzip", () => {
		expect(acceptsGzip("notgzip")).toBe(false);
		expect(acceptsGzip("gzipx")).toBe(false);
	});

	test("a weight that does not parse counts as zero", () => {
		expect(acceptsGzip("gzip;q=abc")).toBe(false);
		expect(acceptsGzip("gzip;q=1.5")).toBe(false);
		expect(acceptsGzip("gzip;q=-1")).toBe(false);
	});
});
