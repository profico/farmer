import { z } from "zod";

export const updateTimeOffPolicyInput = z.object({
	defaultAllowanceDays: z.number().int().min(0),
	carryoverEnabled: z.boolean(),
	carryoverMaxDays: z.number().int().min(0).nullable(),
	carryoverExpiryMonth: z.number().int().min(1).max(12),
	carryoverExpiryDay: z.number().int().min(1).max(31),
});
export type UpdateTimeOffPolicyInput = z.infer<typeof updateTimeOffPolicyInput>;

export const setMemberAllowanceInput = z.object({
	userId: z.string(),
	allowanceDays: z.number().int().min(0).nullable(),
});
export type SetMemberAllowanceInput = z.infer<typeof setMemberAllowanceInput>;

export const getTimeOffBalanceInput = z
	.object({ year: z.coerce.number().int().optional() })
	.optional();
export type GetTimeOffBalanceInput = z.infer<typeof getTimeOffBalanceInput>;
