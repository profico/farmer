import { z } from "zod";

import { dayKeySchema } from "./day-key";

export const listHolidaysForYearInput = z.coerce.number().int();
export type ListHolidaysForYearInput = z.infer<typeof listHolidaysForYearInput>;

// The widest span a holiday range read may cover. `holidaySetForRange`
// evaluates the calendar once per year the range touches, so an unbounded span
// (`1000-01-01 → 9999-12-31`) was thousands of synchronous rule evaluations in
// one request. The week and month views ask for a few weeks at most; 366 is the
// report ceiling, kept as a backstop rather than an opinion.
const MAX_HOLIDAY_RANGE_DAYS = 366;

export const listHolidaysForRangeInput = z
	.object({
		from: dayKeySchema,
		to: dayKeySchema,
	})
	.refine(
		(data) => {
			const from = new Date(`${data.from}T00:00:00Z`).getTime();
			const to = new Date(`${data.to}T00:00:00Z`).getTime();
			return (to - from) / 86_400_000 <= MAX_HOLIDAY_RANGE_DAYS;
		},
		{
			message: `Range too large (max ${MAX_HOLIDAY_RANGE_DAYS} days)`,
			path: ["to"],
		},
	);
export type ListHolidaysForRangeInput = z.infer<
	typeof listHolidaysForRangeInput
>;

export const setHolidayDisabledInput = z.object({
	name: z.string().min(1),
	disabled: z.boolean(),
});
export type SetHolidayDisabledInput = z.infer<typeof setHolidayDisabledInput>;
