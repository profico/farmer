import { z } from "zod";

export const year = z.number().int().min(2000).max(2100);

export const month = z.number().int().min(1).max(12);

export const setMonthlyHourFundInput = z.object({
	year,
	month,
	// Stored in seconds like every other duration in the system; the Settings UI
	// takes hours and converts.
	fundSeconds: z
		.number()
		.int()
		.min(0)
		.max(400 * 3600),
});

export type SetMonthlyHourFundInput = z.infer<typeof setMonthlyHourFundInput>;

export const hourFundYearInput = z.object({ year });

export type HourFundYearInput = z.infer<typeof hourFundYearInput>;

export const monthPeriodInput = z.object({ year, month });

export type MonthPeriodInput = z.infer<typeof monthPeriodInput>;
