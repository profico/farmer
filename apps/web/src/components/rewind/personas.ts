import type { Rewind } from "@farmer/core/services";

// Who the year says you are, the name on the last slides and the share image.
// The first rule that fits wins, so a rare pattern goes before a common one,
// and the largest task group is the fallback. The Expo app holds a copy of
// these rules in `apps/mobile/src/you/rewind/story.ts`: change both.

export type Persona = { title: string; line: string };

type PersonaInput = Pick<
	Rewind,
	| "workedSeconds"
	| "meetingSeconds"
	| "codeReviewSeconds"
	| "overtimeSeconds"
	| "weekendDaysWorked"
	| "longestStreak"
	| "projects"
	| "projectCount"
	| "months"
	| "groups"
	| "pullRequests"
>;

const numbers = new Intl.NumberFormat("en");
const MONTH = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" });
const monthName = (month: number) =>
	MONTH.format(new Date(Date.UTC(2000, month - 1, 1)));

const GROUP_PERSONAS = {
	engineering: {
		title: "The Builder",
		line: "Most of your year went into making things.",
	},
	product: {
		title: "The Strategist",
		line: "You spent the year deciding what gets made, and why.",
	},
	learning: {
		title: "The Scholar",
		line: "You gave more hours to learning than most people plan to.",
	},
	general: {
		title: "The All-Rounder",
		line: "No single lane. A bit of everything, all year.",
	},
	time_off: { title: "The Traveller", line: "A year well rested." },
} satisfies Record<Rewind["groups"][number]["group"], Persona>;

/** The monthly totals of the months with work, the projection included. */
const workedMonths = (rewind: PersonaInput) =>
	rewind.months
		.map((m) => ({ month: m.month, seconds: m.seconds + m.projectedSeconds }))
		.filter((m) => m.seconds > 0);

type Rule = (
	rewind: PersonaInput,
	share: (s: number) => number,
) => Persona | null;

const RULES: Rule[] = [
	(r, share) =>
		share(r.meetingSeconds) > 1 / 3
			? {
					title: "The Connector",
					line: "A third of your year was meetings. The calendar knows you well.",
				}
			: null,
	(r) =>
		r.longestStreak && r.longestStreak.days >= 30
			? {
					title: "The Marathoner",
					line: `${numbers.format(r.longestStreak.days)} working days in a row. You kept going.`,
				}
			: null,
	(r, share) =>
		share(r.codeReviewSeconds) >= 0.15 ||
		(r.pullRequests.reviewed >= 20 &&
			r.pullRequests.reviewed > r.pullRequests.opened)
			? {
					title: "The Reviewer",
					line: "Your reviews kept everyone else's work moving.",
				}
			: null,
	(r) =>
		r.weekendDaysWorked >= 10
			? {
					title: "The Weekend Warrior",
					line: `${numbers.format(r.weekendDaysWorked)} weekend days at work. The week was not enough.`,
				}
			: null,
	(r, share) =>
		share(r.overtimeSeconds) >= 0.1
			? {
					title: "The Closer",
					line: "When it had to ship, you stayed until it did.",
				}
			: null,
	(r, share) => {
		const top = r.projects[0];
		return top && r.projectCount > 1 && share(top.seconds) >= 0.7
			? {
					title: "The Loyalist",
					line: `One project, nearly all year: ${top.name}.`,
				}
			: null;
	},
	(r, share) =>
		r.projectCount >= 6 && share(r.projects[0]?.seconds ?? 0) < 0.35
			? {
					title: "The Juggler",
					line: `${numbers.format(r.projectCount)} projects, and you kept every one of them in the air.`,
				}
			: null,
	(r) => {
		const months = workedMonths(r);
		if (months.length < 3) return null;
		const mean = months.reduce((sum, m) => sum + m.seconds, 0) / months.length;
		const peak = months.reduce((best, m) =>
			m.seconds > best.seconds ? m : best,
		);
		return peak.seconds >= mean * 1.5
			? {
					title: "The Sprinter",
					line: `${monthName(peak.month)} was a sprint. The rest of the year was the pace.`,
				}
			: null;
	},
	(r) => {
		const months = workedMonths(r);
		if (months.length < 10) return null;
		const mean = months.reduce((sum, m) => sum + m.seconds, 0) / months.length;
		return months.every((m) => Math.abs(m.seconds - mean) <= mean * 0.15)
			? {
					title: "The Steady Hand",
					line: "Month after month, the same steady pace.",
				}
			: null;
	},
];

export const personaFor = (rewind: PersonaInput): Persona => {
	const share = (seconds: number) =>
		seconds / Math.max(1, rewind.workedSeconds);
	for (const rule of RULES) {
		const persona = rule(rewind, share);
		if (persona) return persona;
	}
	return GROUP_PERSONAS[rewind.groups[0]?.group ?? "general"];
};
