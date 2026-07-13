import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");

export const utilizationRangeInput = z
	.object({
		from: dateKey,
		to: dateKey,
		// When set, restrict the report to this one member. The admin report omits
		// it (all members); the member-facing "my hours" call pins it to the caller.
		userId: z.string().optional(),
	})
	.refine((data) => data.from <= data.to, {
		message: "from must not be after to",
		path: ["to"],
	});
export type UtilizationRangeInput = z.infer<typeof utilizationRangeInput>;
