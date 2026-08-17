import { describe, expect, test } from "bun:test";
import {
	dayDurationSeconds,
	dayForWeekday,
	defaultDayRow,
	loggedSeconds,
	remainingSeconds,
	spokenForSeconds,
	targetSecondsFor,
	type WorkingHoursDay,
} from "./working-day";

const fullWeek = (): WorkingHoursDay[] =>
	Array.from({ length: 7 }, (_, d) => defaultDayRow(d));

describe("dayDurationSeconds", () => {
	test("measures the configured window", () => {
		expect(
			dayDurationSeconds({
				dayOfWeek: 1,
				enabled: true,
				startTime: "09:00",
				endTime: "17:00",
			}),
		).toBe(8 * 3600);
	});

	test("a disabled day is zero even with times set", () => {
		expect(
			dayDurationSeconds({
				dayOfWeek: 6,
				enabled: false,
				startTime: "09:00",
				endTime: "17:00",
			}),
		).toBe(0);
	});

	test("missing times are zero", () => {
		expect(
			dayDurationSeconds({
				dayOfWeek: 1,
				enabled: true,
				startTime: null,
				endTime: null,
			}),
		).toBe(0);
	});

	test("an end before the start floors at zero rather than going negative", () => {
		expect(
			dayDurationSeconds({
				dayOfWeek: 1,
				enabled: true,
				startTime: "17:00",
				endTime: "09:00",
			}),
		).toBe(0);
	});
});

describe("defaultDayRow", () => {
	test("weekdays default to 9-5, weekends to off", () => {
		expect(dayDurationSeconds(defaultDayRow(1))).toBe(8 * 3600);
		expect(dayDurationSeconds(defaultDayRow(5))).toBe(8 * 3600);
		expect(dayDurationSeconds(defaultDayRow(0))).toBe(0);
		expect(dayDurationSeconds(defaultDayRow(6))).toBe(0);
	});
});

describe("dayForWeekday", () => {
	test("finds the row by dayOfWeek, not by position", () => {
		// A list that is neither complete nor in weekday order — indexing it
		// would return the wrong day.
		const partial: WorkingHoursDay[] = [
			{ dayOfWeek: 3, enabled: true, startTime: "09:00", endTime: "17:00" },
			{ dayOfWeek: 1, enabled: true, startTime: "10:00", endTime: "14:00" },
		];
		expect(dayForWeekday(partial, 1)?.startTime).toBe("10:00");
		expect(dayForWeekday(partial, 3)?.startTime).toBe("09:00");
		expect(dayForWeekday(partial, 2)).toBeUndefined();
	});
});

describe("targetSecondsFor", () => {
	// 2026-08-10 is a Monday, 2026-08-15 a Saturday.
	test("a scheduled weekday returns its duration", () => {
		expect(targetSecondsFor(fullWeek(), "2026-08-10", "Europe/Zagreb")).toBe(
			8 * 3600,
		);
	});

	test("a non-working day is zero", () => {
		expect(targetSecondsFor(fullWeek(), "2026-08-15", "Europe/Zagreb")).toBe(0);
	});

	test("an empty schedule is zero rather than throwing", () => {
		expect(targetSecondsFor([], "2026-08-10", "Europe/Zagreb")).toBe(0);
	});
});

describe("spokenForSeconds", () => {
	test("excludes fill blocks so they do not consume their own budget", () => {
		const claims = [
			{ durationSeconds: 3600, fillsDay: false },
			{ durationSeconds: 1800, fillsDay: false },
			{ durationSeconds: 9999, fillsDay: true },
		];
		expect(spokenForSeconds(claims)).toBe(5400);
	});

	test("no claims is zero", () => {
		expect(spokenForSeconds([])).toBe(0);
	});
});

describe("loggedSeconds", () => {
	test("counts fill blocks, unlike spokenFor", () => {
		const claims = [
			{ durationSeconds: 3600, fillsDay: false },
			{ durationSeconds: 1800, fillsDay: true },
		];
		expect(loggedSeconds(claims)).toBe(5400);
		expect(spokenForSeconds(claims)).toBe(3600);
	});
});

describe("remainingSeconds", () => {
	test("subtracts each claim from the target", () => {
		expect(remainingSeconds(8 * 3600, 3600)).toBe(7 * 3600);
		expect(remainingSeconds(8 * 3600, 3600, 1800, 1800)).toBe(6 * 3600);
	});

	test("floors at zero when the day is over-claimed", () => {
		expect(remainingSeconds(8 * 3600, 9 * 3600)).toBe(0);
	});

	// The day assembler used to floor twice — target-spokenFor, then again after
	// the break. Folding the claims into one call has to give the same answer.
	test("one call matches successive flooring for non-negative claims", () => {
		const target = 8 * 3600;
		const [spokenFor, meetings, breakSeconds] = [3600, 5400, 1800];
		const stepwise = Math.max(
			0,
			Math.max(0, target - spokenFor - meetings) - breakSeconds,
		);
		expect(remainingSeconds(target, spokenFor, meetings, breakSeconds)).toBe(
			stepwise,
		);
	});

	test("a zero target leaves nothing", () => {
		expect(remainingSeconds(0, 0)).toBe(0);
	});
});
