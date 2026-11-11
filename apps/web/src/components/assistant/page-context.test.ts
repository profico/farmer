import { expect, test } from "bun:test";

import {
	buildPageContext,
	type PageContextInput,
	type PageSearch,
	projectIdFromPath,
} from "./page-context.ts";

const base: PageContextInput = {
	pathname: "/acme",
	search: {},
	orgSlug: "acme",
	today: "2026-11-11",
	weekStartsOn: 1,
};

const at = (pathname: string, search: PageSearch = {}, rest = {}) =>
	buildPageContext({ ...base, pathname, search, ...rest });

test("home", () => {
	expect(at("/acme")).toBe("I am on the Home page.");
});

test("time views use the search or today", () => {
	expect(at("/acme/time")).toBe("I am on the Day view for November 11, 2026.");
	expect(at("/acme/time", { date: "2026-10-02" })).toBe(
		"I am on the Day view for October 2, 2026.",
	);
	expect(at("/acme/time/week")).toBe(
		"I am on the Week view for November 9 – 15, 2026.",
	);
	expect(at("/acme/time/week", { weekStart: "2026-11-02" })).toBe(
		"I am on the Week view for November 2 – 8, 2026.",
	);
	expect(at("/acme/time/month", { month: "2026-10" })).toBe(
		"I am on the Month view for October 2026.",
	);
});

test("a project page needs the name", () => {
	expect(at("/acme/projects/p1")).toBeNull();
	expect(at("/acme/projects/p1", {}, { projectName: "Project A" })).toBe(
		'I am on the page of the project "Project A".',
	);
	expect(projectIdFromPath("/acme/projects/p1/team", "acme")).toBe("p1");
	expect(projectIdFromPath("/acme/projects", "acme")).toBeNull();
});

test("the time report names the period and the grouping", () => {
	expect(at("/acme/reports", { month: "2026-10" })).toBe(
		"I am on the Time report for October 1 – 31, 2026, grouped by project.",
	);
	expect(
		at("/acme/reports", { group: "clients", project: "p1", month: "2026-10" }),
	).toBe(
		"I am on the Time report for October 1 – 31, 2026, grouped by client, filtered by project.",
	);
});

test("the tracking report is one month and has no grouping", () => {
	expect(
		at("/acme/reports", {
			tab: "compliance",
			preset: "year",
			month: "2026-10",
		}),
	).toBe("I am on the Tracking report for October 1 – 31, 2026.");
});

test("an unknown page gives no sentence", () => {
	expect(at("/acme/settings/tasks")).toBeNull();
});
