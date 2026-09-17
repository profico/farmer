import { describe, expect, test } from "bun:test";

import { weekDayMarks } from "./day-marks";

const H = 3600;
const MON = "2026-09-07";
const TUE = "2026-09-08";
const WED = "2026-09-09";
const THU = "2026-09-10";
const FRI = "2026-09-11";
const SAT = "2026-09-12";
const SUN = "2026-09-13";
const WEEK = [MON, TUE, WED, THU, FRI, SAT, SUN];
const LAST_SUNDAY = "2026-09-06";
const NEXT_MONDAY = "2026-09-14";

/** The week's marks, Monday first, `null` for a day that is not judged. */
const marksFor = (
	hours: number[],
	today: string,
	holidays: ReadonlySet<string> = new Set(),
) => {
	const marks = weekDayMarks({
		dates: WEEK,
		secondsByDay: new Map(WEEK.map((date, i) => [date, (hours[i] ?? 0) * H])),
		holidays,
		today,
		daySeconds: 8 * H,
	});
	return WEEK.map((date) => marks.get(date) ?? null);
};

describe("weekDayMarks", () => {
	test("an eight-hour week reads as it always did", () => {
		expect(marksFor([8, 8, 8, 8, 8], SAT)).toEqual([
			"done",
			"done",
			"done",
			"done",
			"done",
			null,
			null,
		]);
	});

	test("today stays short for someone exactly on target until they log it", () => {
		expect(marksFor([8, 8, 8, 0], THU)).toEqual([
			"done",
			"done",
			"done",
			"short",
			null,
			null,
			null,
		]);
	});

	test("a finished week that made its hours covers its short days", () => {
		expect(marksFor([10.5, 12, 4, 9, 3.5, 7], NEXT_MONDAY)).toEqual([
			"done",
			"done",
			"covered",
			"done",
			"covered",
			null,
			null,
		]);
	});

	test("short days are short again while the week is behind", () => {
		expect(marksFor([10.5, 12, 4, 9, 3.5, 0], SAT)).toEqual([
			"done",
			"done",
			"short",
			"done",
			"short",
			null,
			null,
		]);
	});

	test("a surplus holds overnight, before today's hours are logged", () => {
		expect(marksFor([10.5, 12, 4, 0], THU)).toEqual([
			"done",
			"done",
			"covered",
			"short",
			null,
			null,
			null,
		]);
	});

	test("today is covered only once the surplus reaches today as well", () => {
		expect(marksFor([12, 12, 12, 2], THU)[3]).toBe("covered");
		expect(marksFor([12, 12, 7, 0], THU)[3]).toBe("short");
	});

	test("an empty weekday in a covered week is covered", () => {
		expect(marksFor([10, 10, 10, 10, 0], SAT)[4]).toBe("covered");
	});

	test("hours logged on a weekend count towards the week", () => {
		expect(marksFor([8, 8, 8, 8, 4, 4], SUN)[4]).toBe("covered");
	});

	test("hours after today do not count", () => {
		// Friday booked off on Monday must not quiet Monday's gap.
		expect(marksFor([4, 0, 0, 0, 8], MON)[0]).toBe("short");
	});

	test("a public holiday is neither judged nor part of the target", () => {
		expect(marksFor([8, 6, 0, 10, 8], SAT, new Set([WED]))).toEqual([
			"done",
			"covered",
			null,
			"done",
			"done",
			null,
			null,
		]);
	});

	test("days after today are not judged", () => {
		expect(marksFor([0, 0, 0, 0, 0], LAST_SUNDAY)).toEqual([
			null,
			null,
			null,
			null,
			null,
			null,
			null,
		]);
		expect(marksFor([8, 8], TUE).slice(2)).toEqual([
			null,
			null,
			null,
			null,
			null,
		]);
	});
});
