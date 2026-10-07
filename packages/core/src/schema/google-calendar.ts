import { z } from "zod";

import { dayKeySchema } from "./day-key";

export const listCalendarEventsInput = z.object({ date: dayKeySchema });
export type ListCalendarEventsInput = z.infer<typeof listCalendarEventsInput>;

// A span of days. The ceiling is a month: every day in it is read from Google
// in one call, and a longer list is more events than a model reads.
const MAX_CALENDAR_SPAN_DAYS = 31;

export const listCalendarEventsRangeInput = z
	.object({ from: dayKeySchema, to: dayKeySchema })
	.refine((data) => data.from <= data.to, {
		message: "from must not be after to",
		path: ["to"],
	})
	.refine(
		(data) => {
			const from = new Date(`${data.from}T00:00:00Z`).getTime();
			const to = new Date(`${data.to}T00:00:00Z`).getTime();
			return (to - from) / 86_400_000 <= MAX_CALENDAR_SPAN_DAYS;
		},
		{
			message: `Range too large (max ${MAX_CALENDAR_SPAN_DAYS} days)`,
			path: ["to"],
		},
	);
export type ListCalendarEventsRangeInput = z.infer<
	typeof listCalendarEventsRangeInput
>;
