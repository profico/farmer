import { z } from "zod";

import type { JsonValue } from "./openapi.gen";

/** Any JSON value: the open part of an answer, such as the details of an
 *  audit event. A screen reads it as data to show, never as a contract. */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(jsonValueSchema),
		z.record(z.string(), jsonValueSchema),
	]),
);

export type { JsonValue };
