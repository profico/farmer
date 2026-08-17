import { z } from "zod";

// The reports screen's URL: which tab, which period, which drill-down.
//
// It lives beside the tabs rather than in the route file because the tabs are
// what read it — `Search` is a prop on half of them — and a component module
// importing its own route's schema from the route would be a cycle.
// Time, Budget burn and Overtime are project-scoped: Admin sees everything, a
// PM or Team Lead sees their own projects (the service narrows the rows). The
// rest are org-wide statements and Admin-only. A plain Member has no report at
// all — they see strictly their own entries, on the timesheet.
export const TABS = [
	{ id: "time", label: "Time", adminOnly: false },
	{ id: "budget", label: "Budget burn", adminOnly: false },
	{ id: "overtime", label: "Overtime", adminOnly: false },
	{ id: "compliance", label: "Tracking", adminOnly: true },
	{ id: "absence", label: "Absence", adminOnly: true },
	{ id: "variance", label: "Variance", adminOnly: true },
	{ id: "utilization", label: "Utilization", adminOnly: true },
	{ id: "not-on-invoice", label: "Not on invoice", adminOnly: true },
] as const;

export type TabId = (typeof TABS)[number]["id"];

const monthKey = z.string().regex(/^\d{4}-\d{2}$/);

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const searchSchema = z.object({
	tab: z
		.enum([
			"time",
			"budget",
			"overtime",
			"compliance",
			"absence",
			"variance",
			"utilization",
			"not-on-invoice",
		])
		.optional(),
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
