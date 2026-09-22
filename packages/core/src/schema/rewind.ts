import { z } from "zod";

import { dayKeySchema } from "./day-key";

export const rewindInput = z.object({
	year: z.number().int().min(2000).max(2100),
	// The day to read the year as of, so December's projection can be looked
	// at in any month. Development only: the server function drops it in
	// production, where the clock is the clock.
	asOf: dayKeySchema.optional(),
});
export type RewindInput = z.infer<typeof rewindInput>;
