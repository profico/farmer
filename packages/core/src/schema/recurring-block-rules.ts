import { z } from "zod";

import { parseDuration } from "../lib/time";
import { MAX_DAY_SECONDS } from "../lib/working-day";
import { dayKeySchema } from "./day-key";

/**
 * The one recurring block the app proposes to everybody: a daily rest break.
 *
 * It is the only block that is true of every person in every org — a workday
 * over six hours legally requires a paid rest break counted within working time
 * (Croatian Labour Act art. 73), which is the same rule `dayAssemblyService`
 * carves its one-off break suggestion against, and the same 30 minutes.
 *
 * Lives here rather than in the service because the settings page renders the
 * proposal — the days, the duration — before any row exists to read it from, and
 * a second copy of "30 minutes, Mon–Fri" in the route would be free to drift.
 * Nothing is written until someone switches it on; see
 * `recurringBlockRulesService.enableBreak`.
 */
export const DEFAULT_BREAK_BLOCK = {
	durationSeconds: 30 * 60,
	daysOfWeek: [1, 2, 3, 4, 5], // Mon–Fri, matching Date#getDay()
	description: "Break",
} as const;

/** A rule's length, as typed. At most a whole day: a rule writes this much onto
 *  each of its days, and a day holds at most `MAX_DAY_SECONDS`. Without the
 *  ceiling a "100h" rule saved, and "1000000h" overflowed the integer column.
 *  The service parses it again for the seconds and the 15-minute step. */
const ruleDuration = z
	.string()
	.min(1, "Duration is required")
	.refine(
		(value) => {
			const seconds = parseDuration(value);
			return seconds === null || seconds <= MAX_DAY_SECONDS;
		},
		{ message: "A recurring block cannot exceed 24 hours" },
	);

/** The weekdays a rule runs on, 0 = Sunday, as a set: deduplicated and
 *  sorted. `[1, 1, 1]` used to be stored as given, so a rule read as running
 *  three times on a Monday, and two rules on the same days compared unequal. */
const ruleWeekdays = z
	.array(z.number().int().min(0).max(6))
	.min(1, "Pick at least one day")
	.transform((days) => [...new Set(days)].sort((a, b) => a - b));

// The mandatory note is not checked here: whether a rule needs one depends on
// its task (a Break rule does not, a Development rule does — `lib/task-rules.ts`)
// and the schema only sees an id. The service asserts it with the task row in
// hand, on create and on update alike, because the entries a rule materializes
// are written straight into the table and would otherwise be un-editable.
export const createRecurringBlockRuleInput = z.object({
	taskId: z.uuid(),
	projectId: z.uuid().optional(),
	description: z.string().optional(),
	daysOfWeek: ruleWeekdays,
	duration: ruleDuration,
	effectiveFrom: dayKeySchema.optional(),
	effectiveUntil: dayKeySchema.optional(),
});
export type CreateRecurringBlockRuleInput = z.infer<
	typeof createRecurringBlockRuleInput
>;

export const updateRecurringBlockRuleInput = z.object({
	ruleId: z.uuid(),
	taskId: z.uuid().optional(),
	// Nullable, unlike on create: `undefined` means "leave the project alone" and
	// `null` means "take it off". Without the distinction an edit form can attach
	// a project to a rule but never detach one, and the break block — which has no
	// project by design — would be a one-way door.
	projectId: z.uuid().nullable().optional(),
	description: z.string().optional(),
	daysOfWeek: ruleWeekdays.optional(),
	duration: ruleDuration.optional(),
	effectiveFrom: dayKeySchema.optional(),
	effectiveUntil: dayKeySchema.optional(),
	active: z.boolean().optional(),
});
export type UpdateRecurringBlockRuleInput = z.infer<
	typeof updateRecurringBlockRuleInput
>;

export const deleteRecurringBlockRuleInput = z.uuid();
export type DeleteRecurringBlockRuleInput = z.infer<
	typeof deleteRecurringBlockRuleInput
>;
