import type { JsonRecord, JsonValue } from "@farmer/core/lib/json";
import { z } from "zod";

import type {
	ApiRequest,
	OrgParams,
	OrgRowParams,
} from "#/server/api-route.ts";

/**
 * The query string of a GET, values for a schema that expects numbers or
 * booleans. A query string holds only text, and `year: z.number()` refuses
 * the text "2026".
 *
 * It shapes and never validates, as a route's `raw` step must:
 *
 *  - A key that is not in the query string stays out.
 *  - A key in `numbers` becomes a number when the text is a number. Other text
 *    stays text, so the schema answers 422 and names the field.
 *  - A key in `booleans` becomes a boolean for "true" and "false". Other text
 *    stays text, for the same reason.
 *  - Every other key stays text. A note filter such as `q=2026` is text.
 */
export const typedQuery =
	({
		numbers = [],
		booleans = [],
	}: {
		numbers?: readonly string[];
		booleans?: readonly string[];
	}) =>
	({ query }: ApiRequest<OrgParams>): JsonRecord => {
		const values: JsonRecord = {};
		for (const [key, text] of query) {
			if (numbers.includes(key) && text.trim() !== "") {
				const value = Number(text);
				values[key] = Number.isFinite(value) ? value : text;
			} else if (
				booleans.includes(key) &&
				(text === "true" || text === "false")
			) {
				values[key] = text === "true";
			} else {
				values[key] = text;
			}
		}
		return values;
	};

/** A JSON object. Only its shape is checked: the schema after it checks the
 *  fields. */
const bodyObject = z.record(z.string(), z.json());

/**
 * The JSON body of a write to one row, with the row's id from the path under
 * `key`. The id is set last, so a body cannot point the write at another row.
 * A body that is not an object goes to the schema as it is, which refuses it.
 */
export const bodyWithPathId =
	(key: string) =>
	({ params, body }: ApiRequest<OrgRowParams>): JsonValue => {
		const parsed = bodyObject.safeParse(body);
		return parsed.success ? { ...parsed.data, [key]: params.id } : body;
	};
