// The version gate in front of every CLI request. A wrong answer here is either
// a binary locked out for no reason, or an old binary let through to misread a
// response shape it cannot parse — and neither shows up as an error anywhere.

import { describe, expect, test } from "bun:test";

import {
	API_VERSION,
	isCliVersionSupported,
	MIN_CLI_VERSION,
	MIN_MOBILE_VERSION,
} from "./meta";

describe("isCliVersionSupported", () => {
	test("accepts the minimum itself", () => {
		expect(isCliVersionSupported(MIN_CLI_VERSION)).toBe(true);
		expect(isCliVersionSupported("0.3.1", "0.3.1")).toBe(true);
	});

	test("accepts anything newer, on each component", () => {
		expect(isCliVersionSupported("0.3.2", "0.3.1")).toBe(true);
		expect(isCliVersionSupported("0.4.0", "0.3.9")).toBe(true);
		expect(isCliVersionSupported("1.0.0", "0.99.99")).toBe(true);
	});

	test("refuses anything older, on each component", () => {
		expect(isCliVersionSupported("0.3.0", "0.3.1")).toBe(false);
		expect(isCliVersionSupported("0.2.9", "0.3.0")).toBe(false);
		expect(isCliVersionSupported("0.99.99", "1.0.0")).toBe(false);
	});

	// Numeric, not lexical: "0.10.0" sorts before "0.9.0" as a string.
	test("compares components as numbers", () => {
		expect(isCliVersionSupported("0.10.0", "0.9.0")).toBe(true);
		expect(isCliVersionSupported("0.9.0", "0.10.0")).toBe(false);
	});

	// A pre-release or build suffix is ignored, so a dev build of the minimum
	// is not locked out of the server it was built against.
	test("ignores a pre-release or build suffix", () => {
		expect(isCliVersionSupported("0.3.0-dev", "0.3.0")).toBe(true);
		expect(isCliVersionSupported("0.3.0+abc123", "0.3.0")).toBe(true);
		expect(isCliVersionSupported("0.2.9-rc.1", "0.3.0")).toBe(false);
	});

	test("accepts a leading v and surrounding whitespace", () => {
		expect(isCliVersionSupported("v0.3.0", "0.3.0")).toBe(true);
		expect(isCliVersionSupported(" 0.3.0 ", "0.3.0")).toBe(true);
	});

	// A binary that cannot say what it is cannot be told it is new enough.
	test("refuses a version that does not parse", () => {
		for (const garbage of ["", "abc", "1.2", "1.2.3.4", "1.x.0", "latest"]) {
			expect(isCliVersionSupported(garbage, "0.1.0")).toBe(false);
		}
	});

	test("refuses everything when the minimum does not parse", () => {
		expect(isCliVersionSupported("9.9.9", "not-a-version")).toBe(false);
	});
});

describe("the mobile contract", () => {
	// A server without `apiVersion` counts as version 1, so the first version
	// that sends the field must be above it.
	test("API_VERSION is an integer above 1", () => {
		expect(Number.isInteger(API_VERSION)).toBe(true);
		expect(API_VERSION).toBeGreaterThan(1);
	});

	test("MIN_MOBILE_VERSION is a version that the comparison reads", () => {
		expect(isCliVersionSupported("9.9.9", MIN_MOBILE_VERSION)).toBe(true);
	});
});
