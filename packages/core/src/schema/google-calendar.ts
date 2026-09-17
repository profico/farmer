import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");

export const listCalendarEventsInput = z.object({ date: dateKey });

export type ListCalendarEventsInput = z.infer<typeof listCalendarEventsInput>;
