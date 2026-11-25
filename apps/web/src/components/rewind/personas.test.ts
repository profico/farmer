import { describe, expect, test } from "bun:test";

import { personaFor } from "./personas.ts";

const HOUR = 3600;

// A plain engineering year: no rule but the group fallback fits it.
const year: Parameters<typeof personaFor>[0] = {
	workedSeconds: 1600 * HOUR,
	meetingSeconds: 100 * HOUR,
	codeReviewSeconds: 50 * HOUR,
	overtimeSeconds: 0,
	weekendDaysWorked: 2,
	longestStreak: { days: 12, from: "2025-03-03", to: "2025-03-18" },
	projects: [
		{
			id: "a",
			name: "Project A",
			icon: null,
			clientName: "Client One",
			seconds: 800 * HOUR,
		},
		{
			id: "b",
			name: "Project B",
			icon: null,
			clientName: "Client One",
			seconds: 800 * HOUR,
		},
	],
	projectCount: 2,
	months: Array.from({ length: 12 }, (_, i) => ({
		month: i + 1,
		// Uneven enough for no Steady Hand, even enough for no Sprinter.
		seconds: (i % 2 === 0 ? 110 : 150) * HOUR,
		projectedSeconds: 0,
	})),
	groups: [{ group: "engineering", seconds: 1600 * HOUR }],
	pullRequests: { opened: 30, merged: 25, reviewed: 10 },
};

const titleOf = (changes: Partial<typeof year>) =>
	personaFor({ ...year, ...changes }).title;

describe("personaFor", () => {
	test("falls back to the largest task group", () => {
		expect(titleOf({})).toBe("The Builder");
		expect(titleOf({ groups: [{ group: "product", seconds: 1 }] })).toBe(
			"The Strategist",
		);
	});

	test("each pattern names its own persona", () => {
		expect(titleOf({ longestStreak: { days: 30, from: "", to: "" } })).toBe(
			"The Marathoner",
		);
		expect(titleOf({ codeReviewSeconds: 300 * HOUR })).toBe("The Reviewer");
		expect(titleOf({ weekendDaysWorked: 10 })).toBe("The Weekend Warrior");
		expect(titleOf({ overtimeSeconds: 200 * HOUR })).toBe("The Closer");
		expect(
			titleOf({
				projects: [
					{
						id: "a",
						name: "Project A",
						icon: null,
						clientName: "Client One",
						seconds: 1200 * HOUR,
					},
				],
			}),
		).toBe("The Loyalist");
		expect(titleOf({ projectCount: 6, projects: [] })).toBe("The Juggler");
	});

	test("one month far above the rest is a sprint", () => {
		const months = year.months.map((m) =>
			m.month === 10 ? { ...m, seconds: 300 * HOUR } : m,
		);
		const persona = personaFor({ ...year, months });
		expect(persona.title).toBe("The Sprinter");
		expect(persona.line).toContain("October");
	});

	test("an even year is steady", () => {
		const months = year.months.map((m) => ({ ...m, seconds: 130 * HOUR }));
		expect(titleOf({ months })).toBe("The Steady Hand");
	});

	test("a rare pattern wins over a common one", () => {
		expect(
			titleOf({
				meetingSeconds: 700 * HOUR,
				longestStreak: { days: 40, from: "", to: "" },
			}),
		).toBe("The Connector");
		expect(
			titleOf({
				longestStreak: { days: 40, from: "", to: "" },
				weekendDaysWorked: 20,
			}),
		).toBe("The Marathoner");
	});
});
