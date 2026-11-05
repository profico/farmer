import { describe, expect, test } from "bun:test";

import {
	buildWeekChart,
	dayFigure,
	dayVerdict,
	githubSummary,
	greetingForHour,
	PLOT_H,
	resolveSelectedDay,
	summarizeAutoTracked,
	type WeekDay,
} from "./org-home.ts";

const day = (over: Partial<WeekDay>): WeekDay => ({
	label: "Mon",
	key: "2026-10-05",
	seconds: 0,
	isToday: false,
	isWeekend: false,
	holiday: undefined,
	mark: undefined,
	...over,
});

describe("dayVerdict and dayFigure", () => {
	test("a holiday is warn and reads hol.", () => {
		const d = day({ holiday: "Day off", mark: "done" });
		expect(dayVerdict(d)).toBe("warn");
		expect(dayFigure(d)).toBe("hol.");
	});
	test("a short day with no time is bad and shows a dash", () => {
		const d = day({ mark: "short" });
		expect(dayVerdict(d)).toBe("bad");
		expect(dayFigure(d)).toBe("—");
	});
	test("a day with no mark is not judged", () => {
		expect(dayVerdict(day({}))).toBe("none");
		expect(dayFigure(day({}))).toBe(" ");
	});
});

test("greetingForHour", () => {
	expect(greetingForHour(11)).toBe("Good morning");
	expect(greetingForHour(12)).toBe("Good afternoon");
	expect(greetingForHour(18)).toBe("Good evening");
});

test("resolveSelectedDay drops a pick outside the week", () => {
	expect(
		resolveSelectedDay("2026-10-06", "2026-10-05", "2026-10-11", "2026-10-07"),
	).toBe("2026-10-06");
	expect(
		resolveSelectedDay("2026-10-12", "2026-10-05", "2026-10-11", "2026-10-07"),
	).toBe("2026-10-07");
	expect(
		resolveSelectedDay(null, "2026-10-05", "2026-10-11", "2026-10-07"),
	).toBe("2026-10-07");
});

test("buildWeekChart orders the week and scales to the target", () => {
	const { perDay, maxDaySeconds, targetPx } = buildWeekChart({
		entries: [{ date: "2026-10-05", durationSeconds: 3600 }],
		weekStart: "2026-10-05",
		weekStartsOn: 1,
		today: "2026-10-07",
		daySeconds: 28800,
		holidays: new Map([["2026-10-06", "Holiday"]]),
	});
	expect(perDay.map((d) => d.label)[0]).toBe("Mon");
	expect(perDay[0]?.seconds).toBe(3600);
	expect(perDay[1]?.holiday).toBe("Holiday");
	expect(perDay[2]?.isToday).toBe(true);
	expect(perDay[5]?.isWeekend).toBe(true);
	expect(maxDaySeconds).toBe(28800);
	expect(targetPx).toBe(PLOT_H);
});

test("summarizeAutoTracked counts meetings and GitHub work", () => {
	const s = summarizeAutoTracked([
		{ date: "d", durationSeconds: 60, calendarEventId: "e" },
		{ date: "d", durationSeconds: 120, commitCount: 2, pullRequestCount: 1 },
		{ date: "d", durationSeconds: 30, commitCount: 0 },
	]);
	expect(s).toEqual({
		meetingCount: 1,
		meetingSeconds: 60,
		githubCount: 1,
		githubSeconds: 120,
		commitTotal: 2,
		pullRequestTotal: 1,
	});
	expect(githubSummary(2, 1)).toBe("2 commits and 1 PR event");
	expect(githubSummary(1, 0)).toBe("1 commit");
});
