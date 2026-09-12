// The task taxonomy, stated once: the groups a task can belong to, the standard
// org task list every workspace gets, and the Harvest-era names that fold into
// it. Pure, so the browser (the Tasks page, the import planner's Web Worker)
// and the server read the same table.
//
// Decided by the COO on 12 Sep 2026 while replacing Harvest: 50 Harvest task
// names became these 21 (plus the built-ins), grouped so the picker can show
// them in four short lists instead of one long one.

export const TASK_GROUPS = [
	"engineering",
	"product",
	"learning",
	"general",
	"time_off",
] as const;
export type TaskGroup = (typeof TASK_GROUPS)[number];

export const TASK_GROUP_LABELS = {
	engineering: "Engineering",
	product: "Product",
	learning: "Learning",
	general: "General",
	time_off: "Time-off",
} satisfies Record<TaskGroup, string>;

/** The org-scoped starter list, in picker order. `systemKey` marks the one the
 *  day assembler resolves by key rather than by name. */
export const STANDARD_TASKS = [
	{ name: "Frontend", group: "engineering", color: "blue" },
	{ name: "Backend", group: "engineering", color: "indigo" },
	{ name: "iOS", group: "engineering", color: "sky" },
	{ name: "Android", group: "engineering", color: "green" },
	{ name: "KMP", group: "engineering", color: "lime" },
	{
		name: "Development",
		group: "engineering",
		color: "cyan",
		systemKey: "development",
	},
	{ name: "WordPress", group: "engineering", color: "slate" },
	{ name: "Bugfixing", group: "engineering", color: "red" },
	{ name: "Code Review", group: "engineering", color: "teal" },
	{ name: "Support", group: "engineering", color: "amber" },
	{ name: "Maintenance", group: "engineering", color: "orange" },
	{ name: "Research", group: "engineering", color: "violet" },
	{ name: "Design", group: "product", color: "pink" },
	{ name: "QA", group: "product", color: "amber" },
	{ name: "Project management", group: "product", color: "slate" },
	{ name: "Data Analytics", group: "product", color: "cyan" },
	{ name: "Education", group: "learning", color: "green" },
	{ name: "Mentoring", group: "learning", color: "teal" },
	{ name: "Workshop", group: "learning", color: "violet" },
	{ name: "Marketing", group: "general", color: "pink" },
	{ name: "Travel", group: "general", color: "slate" },
	{ name: "Other", group: "general", color: "slate" },
] as const satisfies readonly {
	name: string;
	group: TaskGroup;
	color: string;
	systemKey?: "development";
}[];

export type StandardTaskName = (typeof STANDARD_TASKS)[number]["name"];

/** Every name Harvest used that folds into a standard task, keyed by its
 *  normalised form. A standard task's own name is not listed: it maps to
 *  itself. Anything not here is left as the org named it. */
export const TASK_ALIASES = {
	"frontend lead": "Frontend",
	"ios mobile": "iOS",
	appletv: "iOS",
	"android mobile": "Android",
	"dev (web)": "Development",
	architecture: "Development",
	"server setup": "Development",
	setup: "Development",
	forum: "Development",
	"code review and instructions": "Code Review",
	"support & maintenance": "Support",
	monitoring: "Support",
	"ui/ux design": "Design",
	"ux design": "Design",
	"ui design": "Design",
	framer: "Design",
	wireframing: "Design",
	"wireframing & content": "Design",
	"social design": "Design",
	testing: "QA",
	"qa & testing": "QA",
	planning: "Project management",
	organisation: "Project management",
	reporting: "Project management",
	"product owner": "Project management",
	"product strategy": "Project management",
	analytics: "Data Analytics",
	"data & analytics": "Data Analytics",
	"internship management": "Mentoring",
	sales: "Marketing",
	"web content": "Marketing",
	extras: "Other",
	"janitorial services": "Other",
	"janitor work": "Other",
} satisfies Record<string, StandardTaskName>;

const ALIAS_BY_KEY = new Map<string, StandardTaskName>(
	Object.entries(TASK_ALIASES),
);

const normalise = (name: string): string =>
	name.trim().toLowerCase().replace(/\s+/g, " ");

const STANDARD_BY_KEY = new Map(
	STANDARD_TASKS.map((t) => [normalise(t.name), t] as const),
);

/** The standard name a task name resolves to: an alias folds into its target,
 *  a standard name (in any casing) into itself, anything else is returned
 *  trimmed and unchanged. */
export const canonicalTaskName = (name: string): string => {
	const key = normalise(name);
	return ALIAS_BY_KEY.get(key) ?? STANDARD_BY_KEY.get(key)?.name ?? name.trim();
};

/** The group of a standard task name, or null for a name the taxonomy does not
 *  know — the caller decides the default. */
export const groupForTaskName = (name: string): TaskGroup | null =>
	STANDARD_BY_KEY.get(normalise(canonicalTaskName(name)))?.group ?? null;
