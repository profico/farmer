import { z } from "zod";

import { searchFlag } from "#/lib/search-flag.ts";

// The reports screen's URL: which tab, which period, which drill-down.
//
// It lives beside the tabs rather than in the route file because the tabs are
// what read it — `Search` is a prop on half of them — and a component module
// importing its own route's schema from the route would be a cycle.
// Every tab is for everyone, scoped by the services (§4 matrix): an Admin sees
// all of it, a PM their projects and the people on them, a Team Lead their
// people and their projects, a Member themselves.
export const TABS = [
	{ id: "time", label: "Time" },
	{ id: "overtime", label: "Overtime" },
	{ id: "compliance", label: "Tracking" },
	{ id: "absence", label: "Absence" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

const monthKey = z.string().regex(/^\d{4}-\d{2}$/);

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// The period, shared with the project page: `month` anchors every preset but
// Week and Custom; `preset` widens or narrows it, and `from`/`to` carry a week
// or a custom range.
export const periodSearch = {
	month: monthKey.optional(),
	preset: z
		.enum(["day", "week", "month", "quarter", "year", "custom"])
		.optional(),
	from: dateKey.optional(),
	to: dateKey.optional(),
};
const periodSearchSchema = z.object(periodSearch);
export type PeriodSearch = z.infer<typeof periodSearchSchema>;

export const searchSchema = z.object({
	// A tab that no longer exists (a bookmark to a removed report, a typo) is
	// treated as no tab at all and lands on Time, rather than failing the whole
	// route's search validation and showing the error page.
	tab: z
		.enum(["time", "overtime", "compliance", "absence"])
		.optional()
		.catch(undefined),
	// The Time tab's own sub-grouping, mirroring Harvest's three tabs.
	group: z.enum(["clients", "projects", "teammates"]).optional(),
	...periodSearch,
	// "Active projects only".
	active: searchFlag,
	// The Breakdown: the entries behind a number, under up to four filters, in
	// one of five groupings. Filters are ids so a link survives a rename.
	view: z.literal("breakdown").optional(),
	client: z.string().optional(),
	project: z.string().optional(),
	task: z.string().optional(),
	person: z.string().optional(),
	by: z.enum(["client", "project", "task", "teammate", "date"]).optional(),
	// The Absence report's view: one kind of time-off, or "other" for
	// everything that is not vacation. Absent = all of it.
	type: z.enum(["vacation", "sick", "paid", "other"]).optional(),
});

export type Search = z.infer<typeof searchSchema>;
