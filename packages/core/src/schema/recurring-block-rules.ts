import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");

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
	projectId: z.uuid().optional(),
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
