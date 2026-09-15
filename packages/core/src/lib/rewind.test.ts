import { describe, expect, test } from "bun:test";

import {
	defaultRewindYear,
	featuredRewindYear,
	isRewindOpen,
	isWeekendKey,
	longestStreak,
	projectRestOfYear,
	topWords,
} from "./rewind";
import { datesBetween } from "./time";

const H = 3600;
const weekday = (day: string) => !isWeekendKey(day);

describe("when a Rewind opens", () => {
	test("the current year opens on 1 December", () => {
		expect(isRewindOpen(2026, "2026-11-30")).toBe(false);
		expect(isRewindOpen(2026, "2026-12-01")).toBe(true);
		expect(isRewindOpen(2025, "2026-03-10")).toBe(true);
		expect(isRewindOpen(2027, "2026-12-31")).toBe(false);
	});

	test("the home page offers it through December and January only", () => {
		expect(featuredRewindYear("2026-12-01")).toBe(2026);
		expect(featuredRewindYear("2027-01-31")).toBe(2026);
		expect(featuredRewindYear("2027-02-01")).toBeNull();
		expect(defaultRewindYear("2027-06-15")).toBe(2026);
	});
});

describe("longestStreak", () => {
	test("a weekend neither breaks a run nor lengthens it", () => {
		// Mon 1 Dec 2025 to Fri 12 Dec 2025, work on every weekday.
		const days = datesBetween("2025-12-01", "2025-12-12");
		const streak = longestStreak(days, weekday, weekday);
		expect(streak).toEqual({ days: 10, from: "2025-12-01", to: "2025-12-12" });
	});

	test("a working day with no work ends the run", () => {
		const days = datesBetween("2025-12-01", "2025-12-05");
		const streak = longestStreak(days, (day) => day !== "2025-12-03", weekday);
		expect(streak).toEqual({ days: 2, from: "2025-12-01", to: "2025-12-02" });
	});
});

describe("projectRestOfYear", () => {
	const base = {
		yearEnd: "2025-12-31",
		isWorkingDay: weekday,
		daySeconds: 8 * H,
	};

	test("lays the pace so far on every working day still to come", () => {
		// Wed 24 Dec to Wed 31 Dec: today, then Thu, Fri, Mon, Tue, Wed.
		const worked = new Map(
			datesBetween("2025-12-01", "2025-12-23")
				.filter(weekday)
				.map((day) => [day, 6 * H] as const),
		);
		const projection = projectRestOfYear({
			...base,
			today: "2025-12-24",
			firstDay: "2025-12-01",
			workedByDay: worked,
			absenceByDay: new Map(),
		});
		expect(projection?.paceSeconds).toBe(6 * H);
		expect(projection?.totalSeconds).toBe(6 * 6 * H);
		expect(projection?.byMonth.get(12)).toBe(6 * 6 * H);
	});

	test("booked time off and today's logged work are not projected again", () => {
		const worked = new Map<string, number>([
			["2025-12-22", 8 * H],
			["2025-12-23", 8 * H],
			["2025-12-24", 3 * H],
		]);
		const projection = projectRestOfYear({
			...base,
			today: "2025-12-24",
			firstDay: "2025-12-22",
			workedByDay: worked,
			// Away the whole of Thursday, half of Friday, and all next week.
			absenceByDay: new Map([
				["2025-12-25", 8 * H],
				["2025-12-26", 4 * H],
				...datesBetween("2025-12-29", "2025-12-31").map(
					(day) => [day, 8 * H] as const,
				),
			]),
		});
		// Today: 8h pace minus the 3h already logged. Friday: half a day.
		expect(projection?.totalSeconds).toBe(5 * H + 4 * H);
	});

	test("nothing is projected once the year is over, or with no pace", () => {
		const input = {
			...base,
			firstDay: "2025-12-01",
			workedByDay: new Map([["2025-12-01", 8 * H]]),
			absenceByDay: new Map<string, number>(),
		};
		expect(projectRestOfYear({ ...input, today: "2026-01-01" })).toBeNull();
		expect(projectRestOfYear({ ...input, today: "2025-12-01" })).toBeNull();
	});
});

describe("topWords", () => {
	test("counts a word once per note, and drops stop words and links", () => {
		const words = topWords([
			"Checkout checkout checkout with https://example.com/checkout",
			"Checkout fixes",
			"Fixes to the invoice export",
			"Invoice",
		]);
		expect(words).toEqual([
			{ word: "checkout", count: 2 },
			{ word: "fixes", count: 2 },
			{ word: "invoice", count: 2 },
		]);
	});
});
