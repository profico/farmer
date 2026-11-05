import type { z } from "zod";

/**
 * The compile-time check behind every `ContractChecks` list: each answer the
 * server's OpenAPI document describes must parse with the schema the app
 * reads it with. A check that fails turns its line into a type error.
 */
export type Expect<T extends true> = T;

export type Parses<Answer, Schema extends z.ZodType> = [Answer] extends [
	z.input<Schema>,
]
	? true
	: false;
