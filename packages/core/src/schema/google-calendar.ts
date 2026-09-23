import { z } from "zod";

import { dayKeySchema } from "./day-key";

export const listCalendarEventsInput = z.object({ date: dayKeySchema });
export type ListCalendarEventsInput = z.infer<typeof listCalendarEventsInput>;
