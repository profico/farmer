import { z } from "zod";

import { dayKeySchema } from "./day-key";

export const listHolidaysForYearInput = z.coerce.number().int();
export type ListHolidaysForYearInput = z.infer<typeof listHolidaysForYearInput>;

export const listHolidaysForRangeInput = z.object({
	from: dayKeySchema,
	to: dayKeySchema,
});
export type ListHolidaysForRangeInput = z.infer<
	typeof listHolidaysForRangeInput
>;

export const setHolidayDisabledInput = z.object({
	name: z.string().min(1),
	disabled: z.boolean(),
});
export type SetHolidayDisabledInput = z.infer<typeof setHolidayDisabledInput>;
