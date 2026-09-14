import { describe, expect, test } from "bun:test";

import { formatHours, parseQuarterHours } from "./duration";

describe("parseQuarterHours", () => {
	test("reads the three forms the issue names", () => {
		expect(parseQuarterHours("1h30m")).toBe(5400);
		expect(parseQuarterHours("1.5")).toBe(5400);
		expect(parseQuarterHours("90m")).toBe(5400);
	});

	test("reads the web app's other forms too", () => {
		expect(parseQuarterHours("1:30")).toBe(5400);
		expect(parseQuarterHours("2h")).toBe(7200);
		expect(parseQuarterHours("0.25")).toBe(900);
		expect(parseQuarterHours("1,5")).toBe(5400);
	});

	test("refuses a value between quarter-hours and names the two nearest", () => {
		expect(() => parseQuarterHours("1h20m")).toThrow("Use 1h15m or 1h30m.");
		expect(() => parseQuarterHours("1.1")).toThrow("Use 1h or 1h15m.");
	});

	test("below 15 minutes the nearest values are 15m and 30m, not zero", () => {
		expect(() => parseQuarterHours("10m")).toThrow("Use 15m or 30m.");
	});

	test("refuses nothing, too much, and text it cannot read", () => {
		expect(() => parseQuarterHours("0")).toThrow("Enter some time.");
		expect(() => parseQuarterHours("25h")).toThrow("longer than 24 hours");
		expect(() => parseQuarterHours("an hour")).toThrow("Cannot read");
		expect(() => parseQuarterHours("1h30x")).toThrow("Cannot read");
	});
});

test("formatHours prints H:MM", () => {
	expect(formatHours(5400)).toBe("1:30");
	expect(formatHours(0)).toBe("0:00");
	expect(formatHours(36_900)).toBe("10:15");
});
