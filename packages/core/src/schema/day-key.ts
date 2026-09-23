import { z } from "zod";

import { isValidDayKey } from "../lib/time";

/**
 * A yyyy-MM-dd day key that names a day that exists.
 *
 * Every schema used to carry its own copy of the shape regex, and the shape is
 * not enough: "2026-02-31" matches it. Nothing downstream throws on such a key,
 * because day keys are compared as strings — so an entry dated 2026-02-31 was
 * stored and then fell out of every range read, invisible and still counted by
 * nothing. `isValidDayKey` round-trips the key through a date, which is the
 * check; this is the one schema that applies it.
 */
export const dayKeySchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd")
	.refine(isValidDayKey, "Use a real date");
