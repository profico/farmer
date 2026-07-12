import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");

export const timeOffTypeValues = [
	"vacation",
	"sick",
	"personal",
	"unpaid",
	"other",
] as const;

export const createTimeOffRequestInput = z
	.object({
		startDate: dateKey,
		endDate: dateKey,
		type: z.enum(timeOffTypeValues).default("vacation"),
		label: z.string().optional(),
		reviewerUserId: z.string().optional(),
	})
	.refine((data) => data.startDate <= data.endDate, {
		message: "startDate must not be after endDate",
		path: ["endDate"],
	});
export type CreateTimeOffRequestInput = z.infer<
	typeof createTimeOffRequestInput
>;

export const cancelTimeOffRequestInput = z.uuid();
export type CancelTimeOffRequestInput = z.infer<
	typeof cancelTimeOffRequestInput
>;

export const listAllTimeOffRequestsFilterInput = z
	.object({
		status: z.enum(["pending", "approved", "denied"]).optional(),
	})
	.optional();
export type ListAllTimeOffRequestsFilterInput = z.infer<
	typeof listAllTimeOffRequestsFilterInput
>;

export const decideTimeOffRequestInput = z.object({
	requestId: z.uuid(),
	decision: z.enum(["approved", "denied"]),
	note: z.string().optional(),
});
export type DecideTimeOffRequestInput = z.infer<
	typeof decideTimeOffRequestInput
>;
