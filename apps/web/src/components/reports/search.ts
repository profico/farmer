import { z } from "zod";

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
	// The period. `month` drives every month-based report and is also the Time
	// tab's default; `preset` lets Time widen to a week or an arbitrary range
	// (PRD 6.1), in which case `from`/`to` carry it.
	month: monthKey.optional(),
	preset: z.enum(["month", "week", "custom"]).optional(),
	from: dateKey.optional(),
	to: dateKey.optional(),
	// Level 2: which row was clicked, and how to group what's behind it.
	detailKind: z
		.enum(["clients", "projects", "teammates", "overtime"])
		.optional(),
	detailId: z.string().optional(),
	groupBy: z.enum(["date", "person"]).optional(),
});

export type Search = z.infer<typeof searchSchema>;
