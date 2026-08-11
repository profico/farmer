import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");

export const createRecurringBlockRuleInput = z.object({
	taskId: z.uuid(),
	projectId: z.uuid().optional(),
	description: z.string().optional(),
	daysOfWeek: z
		.array(z.number().int().min(0).max(6))
		.min(1, "Pick at least one day"),
	duration: z.string().min(1, "Duration is required"),
	effectiveFrom: dateKey.optional(),
	effectiveUntil: dateKey.optional(),
});
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
