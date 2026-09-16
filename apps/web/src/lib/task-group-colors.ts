import type { TaskGroup } from "@farmer/core/lib/task-taxonomy";

/**
 * The colour a task wears, taken from its GROUP rather than from the task.
 *
 * The taxonomy stores a colour per task — twenty-four of them, "blue",
 * "indigo", "sky" — and a row wearing one of twenty-four colours is wearing a
 * colour that carries nothing: nobody learns twenty-four, so the dot on an
 * entry row was decoration. There are exactly five groups, so a group colour is
 * a family you learn in one glance: everything engineering reads as one thing,
 * everything product as another, and a booked day off is instantly not-work.
 *
 * The values live in `styles.css` beside the rest of the palette (both themes),
 * so a chip follows the theme without this module knowing anything about it.
 * Tailwind cannot build a class name at runtime, so the classes are written out
 * rather than interpolated.
 */
const GROUP_CHIP = {
	engineering: "bg-group-engineering/15 text-group-engineering",
	product: "bg-group-product/15 text-group-product",
	learning: "bg-group-learning/15 text-group-learning",
	general: "bg-secondary text-muted-foreground",
	time_off: "bg-group-time-off/15 text-group-time-off",
} as const satisfies Record<TaskGroup, string>;

/** The chip classes for a task's group. `general` is deliberately the neutral
 *  chip: it is the group a task lands in when it belongs to no family, so
 *  giving it a colour of its own would say it is one. */
export const taskGroupChipClass = (group: TaskGroup | null | undefined) =>
	GROUP_CHIP[group ?? "general"] ?? GROUP_CHIP.general;
