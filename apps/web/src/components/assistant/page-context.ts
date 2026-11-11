import { resolveReportPeriod } from "@farmer/core/lib/report-period";
import type { WeekStartsOn } from "@farmer/core/lib/time";
import { addDaysToKey, startOfWeekKey } from "@farmer/core/lib/time";
import { dayKeySchema } from "@farmer/core/schema";
import { z } from "zod";

import {
	searchSchema as reportsSearch,
	TABS,
} from "#/components/reports/search.ts";
import {
	formatDateKeyLong,
	formatMonthKey,
	formatWeekRange,
} from "#/lib/format-date.ts";

// One plain sentence that names the page a person is on. The dialog shows it
// and the person may remove it. It holds only what the URL holds: no hidden data.

export type PageContextInput = {
	/** The path of the current page, with the `/$orgSlug` prefix. */
	pathname: string;
	/** The search params of the current page, parsed with `pageSearch`. */
	search: PageSearch;
	orgSlug: string;
	today: string;
	weekStartsOn: WeekStartsOn;
	/** The name of the project when the page is a project page. */
	projectName?: string | null;
};

/** The search of every page that has a sentence: the timesheet and the reports. */
export const pageSearch = reportsSearch.extend({
	date: dayKeySchema.optional().catch(undefined),
	weekStart: dayKeySchema.optional().catch(undefined),
});
export type PageSearch = z.infer<typeof pageSearch>;

const GROUP_WORD = {
	clients: "client",
	projects: "project",
	teammates: "teammate",
} as const;

const FILTER_WORDS = [
	["client", "client"],
	["project", "project"],
	["task", "task"],
	["person", "person"],
] as const;

const pathWithin = (pathname: string, orgSlug: string) => {
	const rest = pathname.startsWith(`/${orgSlug}`)
		? pathname.slice(orgSlug.length + 1)
		: pathname;
	return rest.replace(/\/+$/, "");
};

/** The project id of a project page, or null. */
export function projectIdFromPath(pathname: string, orgSlug: string) {
	const match = /^\/projects\/([^/]+)/.exec(pathWithin(pathname, orgSlug));
	return match?.[1] ?? null;
}

function timeSentence(
	path: string,
	parsed: PageSearch,
	today: string,
	weekStartsOn: WeekStartsOn,
) {
	if (path === "/time") {
		return `the Day view for ${formatDateKeyLong(parsed.date ?? today)}`;
	}
	if (path === "/time/week") {
		const from = parsed.weekStart ?? startOfWeekKey(today, weekStartsOn);
		return `the Week view for ${formatWeekRange(from, addDaysToKey(from, 6))}`;
	}
	if (path === "/time/month") {
		return `the Month view for ${formatMonthKey(parsed.month ?? today.slice(0, 7))}`;
	}
	return null;
}

function reportSentence(
	parsed: PageSearch,
	today: string,
	weekStartsOn: WeekStartsOn,
) {
	const tab = TABS.find((entry) => entry.id === parsed.tab) ?? TABS[0];
	// Tracking is always one month.
	const selection = tab.id === "compliance" ? { month: parsed.month } : parsed;
	const { from, to } = resolveReportPeriod(selection, today, weekStartsOn);
	const parts = [`the ${tab.label} report for ${formatWeekRange(from, to)}`];
	if (tab.id === "time") {
		parts.push(`grouped by ${GROUP_WORD[parsed.group ?? "projects"]}`);
	}
	const filters = FILTER_WORDS.filter(([key]) => parsed[key]).map(
		([, word]) => word,
	);
	if (filters.length > 0) parts.push(`filtered by ${filters.join(" and ")}`);
	return parts.join(", ");
}

function projectSentence(path: string, name: string | null | undefined) {
	if (!name) return null;
	const sub = /^\/projects\/[^/]+\/(\w+)$/.exec(path)?.[1];
	return sub
		? `the ${sub} page of the project "${name}"`
		: `the page of the project "${name}"`;
}

/** The sentence for the current page, or null when the page is not known. */
export function buildPageContext(input: PageContextInput): string | null {
	const path = pathWithin(input.pathname, input.orgSlug);
	const { today, weekStartsOn } = input;
	let place: string | null = null;
	if (path === "") place = "the Home page";
	else if (path.startsWith("/time")) {
		place = timeSentence(path, input.search, today, weekStartsOn);
	} else if (path === "/reports") {
		place = reportSentence(input.search, today, weekStartsOn);
	} else if (path.startsWith("/projects/")) {
		place = projectSentence(path, input.projectName);
	}
	return place ? `I am on ${place}.` : null;
}
