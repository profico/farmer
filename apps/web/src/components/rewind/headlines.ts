// The headline of each Rewind slide, chosen from the person's own figures.
// Pure, so a test can pin the thresholds. `mark` is the part of `text` that the
// slide sets in the accent color.

export type Headline = { text: string; mark?: string };

const numbers = new Intl.NumberFormat("en");

/** This year against last year, in whole percent. In December the year is not
 *  over, so the projection stands in for the full year. Null when there is
 *  nothing fair to compare: no previous year, or one under half of this one,
 *  which is a part year (a person who joined mid-year), not a slower one. */
export const yearChange = (
	worked: number,
	projected: number | null,
	previous: number | null,
): number | null => {
	const current = projected ?? worked;
	if (previous == null || previous <= 0 || previous * 2 < current) return null;
	return Math.round(((current - previous) / previous) * 100);
};

export const hoursHeadline = ({
	year,
	change,
	complete,
	workingDays,
}: {
	year: number;
	change: number | null;
	complete: boolean;
	workingDays: number;
}): Headline => {
	const pace = complete ? "" : "On pace for ";
	if (change != null && change >= 5) {
		const mark = `${change}% more`;
		return { text: `${pace}${mark} than ${year - 1}.`, mark };
	}
	if (change != null && change <= -5) {
		const mark = `${-change}% less`;
		return { text: `${pace}${mark} than ${year - 1}.`, mark };
	}
	if (workingDays >= 220)
		return { text: "A full year, start to finish.", mark: "full year" };
	return { text: "Every one of them on the record." };
};

export const daysHeadline = (streakDays: number | null): Headline => {
	if (streakDays != null && streakDays >= 5) {
		const mark = `${numbers.format(streakDays)} working days`;
		return { text: `Your longest run: ${mark} in a row.`, mark };
	}
	return { text: "You showed up.", mark: "showed up" };
};

/** `months` are the twelve monthly totals in seconds. */
export const monthsHeadline = (
	busiestName: string,
	months: readonly number[],
): Headline => {
	const worked = months.filter((seconds) => seconds > 0);
	const mean =
		worked.reduce((sum, s) => sum + s, 0) / Math.max(1, worked.length);
	const busiest = Math.max(0, ...months);
	if (worked.length > 1 && busiest >= mean * 1.4)
		return { text: `${busiestName} ran hot.`, mark: busiestName };
	return {
		text: `A steady year. ${busiestName} edged ahead.`,
		mark: busiestName,
	};
};

export const projectsHeadline = ({
	topName,
	share,
	projectCount,
}: {
	topName: string;
	/** The top project's part of the year, 0 to 1. */
	share: number;
	projectCount: number;
}): Headline => {
	if (projectCount === 1 || share >= 0.5)
		return { text: `${topName} took most of your year.`, mark: topName };
	if (share >= 0.25) return { text: `${topName} led the way.`, mark: topName };
	const mark = `${numbers.format(projectCount)} projects`;
	return { text: `Spread across ${mark}.`, mark };
};

export const GROUP_PHRASES = {
	engineering: "engineering",
	product: "product work",
	learning: "learning",
	general: "general work",
	time_off: "time off",
} as const;

export const tasksHeadline = (
	group: keyof typeof GROUP_PHRASES,
	share: number,
): Headline => {
	const mark = GROUP_PHRASES[group];
	return share >= 0.5
		? { text: `Mostly ${mark}.`, mark }
		: { text: `A mix, led by ${mark}.`, mark };
};

/** `count` is the number of notes that hold the word, not its uses. */
export const wordsHeadline = (word: string, count: number): Headline => {
	const mark = `“${word}”`;
	const notes = `${numbers.format(count)} ${count === 1 ? "note" : "notes"}`;
	return { text: `${mark} came up in ${notes}.`, mark };
};

export const githubHeadline = ({
	commits,
	opened,
	merged,
	reviewed,
}: {
	commits: number;
	opened: number;
	merged: number;
	reviewed: number;
}): Headline => {
	if (reviewed >= 10 && reviewed > opened)
		return { text: "You reviewed more than you opened.", mark: "reviewed" };
	if (merged >= 50) {
		const mark = `${numbers.format(merged)} pull requests`;
		return { text: `${mark}, merged.`, mark };
	}
	if (commits >= 500) {
		const mark = `${numbers.format(commits)} commits`;
		return { text: `${mark}. You shipped.`, mark };
	}
	return { text: "You shipped.", mark: "shipped" };
};
