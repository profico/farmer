import { describe, expect, test } from "bun:test";

import { durationFromEnv } from "./http";

describe("a duration from the environment", () => {
	test("unset, empty, blank, invalid or negative gives the fallback", () => {
		for (const raw of [undefined, "", "  ", "abc", "-5"]) {
			expect(durationFromEnv(raw, 15_000)).toBe(15_000);
			expect(durationFromEnv(raw, 60_000, "off")).toBe(60_000);
		}
	});

	test("an explicit number is used", () => {
		expect(durationFromEnv("90000", 15_000)).toBe(90_000);
		expect(durationFromEnv(" 2500 ", 15_000)).toBe(2_500);
	});

	test("0 is off only where the limit allows it", () => {
		// A deadline of 0 ms fails every call, so it is not a value.
		expect(durationFromEnv("0", 15_000)).toBe(15_000);
		// The stall watchdog is the one limit that 0 turns off.
		expect(durationFromEnv("0", 60_000, "off")).toBe(0);
	});
});
