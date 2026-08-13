import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");

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

// A rule against a project must carry a note, for the same reason a time entry
// against a project must: the entries this rule materializes ARE worked time,
// and they are written straight into the table by `materializeRange` rather than
// through `createTimeEntryInput`. Letting the note be optional here produced
// entries that broke the app's own mandatory-description rule — and the trap
// only sprang later, when someone opened one of those entries to change its
// hours and could not save it without writing the note the rule had called
// optional. Absence rules carry no project and need no note, as everywhere else.
export const requireNoteWithProject = <
	T extends { projectId?: string; description?: string },
>(
	data: T,
	ctx: z.RefinementCtx,
) => {
	if (data.projectId && !data.description?.trim()) {
		ctx.addIssue({
			code: "custom",
			path: ["description"],
			message: "Describe what this block is for",
		});
	}
};

export const createRecurringBlockRuleInput = z
	.object({
		taskId: z.uuid(),
		projectId: z.uuid().optional(),
		description: z.string().optional(),
		daysOfWeek: z
			.array(z.number().int().min(0).max(6))
			.min(1, "Pick at least one day"),
		duration: z.string().min(1, "Duration is required"),
		effectiveFrom: dateKey.optional(),
		effectiveUntil: dateKey.optional(),
	})
	.superRefine(requireNoteWithProject);
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
	daysOfWeek: z
		.array(z.number().int().min(0).max(6))
		.min(1, "Pick at least one day")
		.optional(),
	duration: z.string().min(1).optional(),
	effectiveFrom: dateKey.optional(),
	effectiveUntil: dateKey.optional(),
	active: z.boolean().optional(),
});
export type UpdateRecurringBlockRuleInput = z.infer<
	typeof updateRecurringBlockRuleInput
>;

export const deleteRecurringBlockRuleInput = z.uuid();
export type DeleteRecurringBlockRuleInput = z.infer<
	typeof deleteRecurringBlockRuleInput
>;
