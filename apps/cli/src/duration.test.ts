import { describe, expect, test } from "bun:test";

import { addToDuration, formatHours, parseQuarterHours } from "./duration";

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

describe("addToDuration", () => {
	test("adds to the time already logged", () => {
		expect(addToDuration(12_600, "1.25")).toBe(17_100);
		expect(addToDuration(0, "15m")).toBe(900);
	});

	test("holds the addend to the same 15-minute rule", () => {
		expect(() => addToDuration(3600, "10m")).toThrow("Use 15m or 30m.");
		expect(() => addToDuration(3600, "an hour")).toThrow("Cannot read");
		expect(() => addToDuration(3600, "0")).toThrow("Enter some time.");
	});

	test("refuses a total over 24 hours, which the addend alone can pass", () => {
		expect(() => addToDuration(82_800, "2h")).toThrow(
			"23h plus 2h is more than 24 hours",
		);
	});
});

test("formatHours prints H:MM", () => {
	expect(formatHours(5400)).toBe("1:30");
	expect(formatHours(0)).toBe("0:00");
	expect(formatHours(36_900)).toBe("10:15");
});
