// `formatHoursLabel` is how every report tab and the CSV header write a
// duration, and callers hand it negative figures directly. Two shapes came out
// wrong: a negative split into two negative parts ("-2h -30m" for -1.5h), and a
// remainder that rounded up to a full hour without carrying ("60m").

import { describe, expect, test } from "bun:test";

import { formatHoursLabel } from "./report-format";

const H = 3600;
const M = 60;

describe("formatHoursLabel", () => {
	test("hours and minutes", () => {
		expect(formatHoursLabel(6 * H + 30 * M)).toBe("6h 30m");
		expect(formatHoursLabel(H)).toBe("1h");
		expect(formatHoursLabel(30 * M)).toBe("30m");
		expect(formatHoursLabel(0)).toBe("0h");
	});

	test("groups thousands", () => {
		expect(formatHoursLabel(1234 * H + 5 * M)).toBe("1,234h 5m");
	});

	test("a negative figure carries its sign once, in front", () => {
		expect(formatHoursLabel(-5400)).toBe("-1h 30m");
		expect(formatHoursLabel(-2 * H)).toBe("-2h");
		expect(formatHoursLabel(-30 * M)).toBe("-30m");
	});

	test("a remainder that rounds to a whole hour carries into the hours", () => {
		expect(formatHoursLabel(3599)).toBe("1h");
		expect(formatHoursLabel(2 * H - 1)).toBe("2h");
		expect(formatHoursLabel(-3599)).toBe("-1h");
	});

	test("a figure that rounds to nothing is 0h, never -0h", () => {
		expect(formatHoursLabel(29)).toBe("0h");
		expect(formatHoursLabel(-29)).toBe("0h");
	});
});
