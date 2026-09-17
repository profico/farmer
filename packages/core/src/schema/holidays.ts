import { z } from "zod";

export const listHolidaysForYearInput = z.coerce.number().int();

export type ListHolidaysForYearInput = z.infer<typeof listHolidaysForYearInput>;

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");

export const listHolidaysForRangeInput = z.object({
	from: dateKey,
	to: dateKey,
});

export type ListHolidaysForRangeInput = z.infer<
	typeof listHolidaysForRangeInput
>;

export const setHolidayDisabledInput = z.object({
	name: z.string().min(1),
	disabled: z.boolean(),
});

export type SetHolidayDisabledInput = z.infer<typeof setHolidayDisabledInput>;
