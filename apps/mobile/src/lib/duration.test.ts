/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import {
	formatHours,
	formatStopwatch,
	MAX_DAY_SECONDS,
	QUARTER_HOUR_SECONDS,
	stepQuarter,
	toQuarter,
} from "./duration";

describe("durations", () => {
	test("format as hours and minutes", () => {
		expect(formatHours(0)).toBe("0:00");
		expect(formatHours(27_000)).toBe("7:30");
		expect(formatStopwatch(3723)).toBe("1:02:03");
	});

	test("step in quarter hours between one step and a day", () => {
		expect(stepQuarter(QUARTER_HOUR_SECONDS, -1)).toBe(QUARTER_HOUR_SECONDS);
		expect(stepQuarter(3600, 1)).toBe(4500);
		expect(stepQuarter(MAX_DAY_SECONDS, 1)).toBe(MAX_DAY_SECONDS);
	});

	test("move a value onto the grid", () => {
		expect(toQuarter(0)).toBe(QUARTER_HOUR_SECONDS);
		expect(toQuarter(1000)).toBe(QUARTER_HOUR_SECONDS);
		expect(toQuarter(1400)).toBe(1800);
	});
});
