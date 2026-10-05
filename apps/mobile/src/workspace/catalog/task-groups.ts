/**
 * The task groups and the colours of a task, with the same values and
 * labels as the web app (`task-taxonomy` and `category-colors`).
 */

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
} satisfies { [group in TaskGroup]: string };

/** The groups a person can put an organization task under. Time-off is
 *  for the built-in absence tasks. */
export const EDITABLE_GROUPS = TASK_GROUPS.filter(
	(group) => group !== "time_off",
);

/** The group of a task that the app may not know yet. */
export const groupOf = (value: string): TaskGroup | null =>
	TASK_GROUPS.find((group) => group === value) ?? null;

/** The five colours of the web picker and its neutral grey, in picker
 *  order. */
export const TASK_COLORS = [
	{ value: "#6b7f6a", label: "Sage" },
	{ value: "#55707d", label: "Slate" },
	{ value: "#8a6a1f", label: "Ochre" },
	{ value: "#9c5a44", label: "Rust" },
	{ value: "#7a6a86", label: "Mauve" },
	{ value: "#79736a", label: "Grey" },
] as const;

export const DEFAULT_TASK_COLOR = TASK_COLORS[0].value;

/** The colour for the dot of a task with no colour. */
export const FALLBACK_TASK_COLOR = "#79736a";
