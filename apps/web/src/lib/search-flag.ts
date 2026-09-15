import { z } from "zod";

/**
 * A search param that is either on (`"1"`) or absent: `?archived` on the list
 * screens, `?active` on the reports. The router JSON-parses search values, so
 * the `"1"` the app writes comes back a string while a hand-typed
 * `?archived=1` comes back the number 1. A bare `z.literal("1")` refused the
 * number, and a refused search param fails the whole route — the page showed
 * "Something went wrong". Both spellings read as on; anything else reads as
 * absent rather than as an error.
 */
export const searchFlag = z
	.union([z.literal("1"), z.literal(1)])
	.transform((): "1" => "1")
	.optional()
	.catch(undefined);
