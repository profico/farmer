import { z } from "zod";

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Expected HH:mm");

export const upsertWorkingHoursDayInput = z.object({
	dayOfWeek: z.number().int().min(0).max(6),
	enabled: z.boolean(),
	startTime: hhmm.optional(),
	endTime: hhmm.optional(),
});
export type UpsertWorkingHoursDayInput = z.infer<
	typeof upsertWorkingHoursDayInput
>;
