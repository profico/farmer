import type { Rewind } from "@farmer/api-client";

// The content of a Rewind: when it opens, which slides it has, and the
// words and figures on them. The web app (`components/rewind/slides.tsx`)
// has the same rules, and `packages/core/src/lib/rewind.ts` decides when a
// year opens. The app cannot import either, so this file restates them. It
// imports nothing from React Native, so `bun test` can run it.

/** The month a year's Rewind opens in. */
export const REWIND_OPENS_MONTH = 12;

const yearOf = (day: string) => Number(day.slice(0, 4));
const monthOf = (day: string) => Number(day.slice(5, 7));

/** Any year already over, and the current year from 1 December. */
export const isRewindOpen = (year: number, today: string): boolean =>
	year < yearOf(today) ||
	(year === yearOf(today) && monthOf(today) >= REWIND_OPENS_MONTH);

/** This year's Rewind in December, last year's in January, else null. The
 *  More tab shows the Rewind row only when this is not null, as the web
 *  shows its banner. */
export const featuredRewindYear = (today: string): number | null => {
	const month = monthOf(today);
	if (month === REWIND_OPENS_MONTH) return yearOf(today);
	if (month === 1) return yearOf(today) - 1;
	return null;
};

/** The year the screen opens when nobody chose one. */
export const defaultRewindYear = (today: string): number =>
	featuredRewindYear(today) ?? yearOf(today) - 1;

// ── Words and figures ───────────────────────────────────────────────────

const numbers = new Intl.NumberFormat("en");

export const formatNumber = (n: number): string => numbers.format(n);

export const wholeHours = (seconds: number): string =>
	numbers.format(Math.round(seconds / 3600));

export const tenthHours = (seconds: number): string =>
	numbers.format(Math.round(seconds / 360) / 10);

export const plural = (n: number, one: string, many = `${one}s`): string =>
	`${numbers.format(n)} ${n === 1 ? one : many}`;

export const monthName = (month: number): string =>
	new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(
		new Date(Date.UTC(2000, month - 1, 1)),
	);

/** "Thursday, 4 June". */
export const longDay = (key: string): string =>
	new Intl.DateTimeFormat("en", {
		weekday: "long",
		day: "numeric",
		month: "long",
		timeZone: "UTC",
	}).format(new Date(`${key}T00:00:00Z`));

/** "4 Jun". */
export const shortDay = (key: string): string =>
	new Intl.DateTimeFormat("en", {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	}).format(new Date(`${key}T00:00:00Z`));

/** 1 January 2023 was a Sunday, so day `d` of that week is weekday `d`. */
export const weekdayName = (weekday: number): string =>
	new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(
		new Date(Date.UTC(2023, 0, 1 + weekday)),
	);

/** A share of the year as a whole percent. A small share that rounds to
 *  nothing shows as "<1%", not as "0%". */
export const sharePercent = (seconds: number, total: number): string => {
	const percent = Math.round((seconds / total) * 100);
	return percent === 0 && seconds > 0 ? "<1%" : `${percent}%`;
};

/** The change from the year before, in whole percent, or null. */
export const changeFromLastYear = (rewind: Rewind): number | null => {
	const previous = rewind.previousYearWorkedSeconds;
	if (previous == null || previous === 0) return null;
	return Math.round(((rewind.workedSeconds - previous) / previous) * 100);
};

export const busiestMonth = (rewind: Rewind) =>
	rewind.months.reduce(
		(best, month) => (month.seconds > best.seconds ? month : best),
		rewind.months[0] ?? { month: 1, seconds: 0, projectedSeconds: 0 },
	);

/** The weekday with the most hours, 0 is Sunday. */
export const strongestWeekday = (rewind: Rewind): number =>
	rewind.weekdays.indexOf(Math.max(...rewind.weekdays));

const GROUP_LABELS = new Map([
	["engineering", "Engineering"],
	["product", "Product"],
	["learning", "Learning"],
	["general", "General"],
	["time_off", "Time off"],
]);

export const groupLabel = (group: string): string =>
	GROUP_LABELS.get(group) ?? group;

const ALL_ROUNDER = {
	title: "The All-Rounder",
	line: "No single lane. A bit of everything, all year.",
};

const PERSONAS = new Map([
	[
		"engineering",
		{
			title: "The Builder",
			line: "Most of your year went into making things.",
		},
	],
	[
		"product",
		{
			title: "The Strategist",
			line: "You spent the year deciding what gets made, and why.",
		},
	],
	[
		"learning",
		{
			title: "The Scholar",
			line: "You gave more hours to learning than most people plan to.",
		},
	],
	[
		"general",
		{
			title: "The All-Rounder",
			line: "No single lane. A bit of everything, all year.",
		},
	],
	["time_off", { title: "The Traveller", line: "A year well rested." }],
]);

/** Who the year says you are: the Connector when meetings took more than a
 *  third of it, else the group that got the most hours. */
export const personaFor = (rewind: Rewind) => {
	if (rewind.meetingSeconds / Math.max(1, rewind.workedSeconds) > 1 / 3) {
		return {
			title: "The Connector",
			line: "A third of your year was meetings. The calendar knows you well.",
		};
	}
	const group = rewind.groups[0]?.group ?? "general";
	return PERSONAS.get(group) ?? ALL_ROUNDER;
};

/** The year in six figures. The summary slide and the shared text both
 *  read them from here, so the two always agree. */
export const summaryTiles = (rewind: Rewind) => [
	{ label: "Hours", value: wholeHours(rewind.workedSeconds) },
	{ label: "Days", value: formatNumber(rewind.daysWorked) },
	{ label: "Top project", value: rewind.projects[0]?.name ?? "None" },
	{ label: "Biggest month", value: monthName(busiestMonth(rewind).month) },
	{
		label: "Longest run",
		value: rewind.longestStreak
			? plural(rewind.longestStreak.days, "day")
			: "None",
	},
	{ label: "You are", value: personaFor(rewind).title },
];

/** The text the share sheet sends. */
export const shareText = (rewind: Rewind): string =>
	[
		`My Farmer Rewind ${rewind.year}`,
		...summaryTiles(rewind).map((tile) => `${tile.label}: ${tile.value}`),
	].join("\n");

// ── The slides ──────────────────────────────────────────────────────────

export type SlideKind =
	| "intro"
	| "empty"
	| "hours"
	| "days"
	| "months"
	| "bigDay"
	| "projects"
	| "tasks"
	| "words"
	| "github"
	| "timeOff"
	| "persona"
	| "summary";

/** The slides of a Rewind, in order. A slide with nothing to say is left
 *  out, as on the web. */
export const slidesOf = (rewind: Rewind): SlideKind[] => {
	if (rewind.workedSeconds === 0) return ["intro", "empty"];
	const slides: SlideKind[] = ["intro", "hours", "days", "months"];
	if (rewind.busiestDay) slides.push("bigDay");
	if (rewind.projects.length > 0) slides.push("projects");
	if (rewind.tasks.length > 0) slides.push("tasks");
	if (rewind.words.length >= 3) slides.push("words");
	const { pullRequests } = rewind;
	if (
		rewind.commits +
			pullRequests.opened +
			pullRequests.merged +
			pullRequests.reviewed >
		0
	) {
		slides.push("github");
	}
	const { vacationDays, sickDays, otherDays } = rewind.timeOff;
	if (vacationDays + sickDays + otherDays > 0) slides.push("timeOff");
	slides.push("persona", "summary");
	return slides;
};
