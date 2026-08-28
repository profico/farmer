/**
 * A value that has been through `JSON.parse`.
 *
 * Deliberately NOT a substitute for parsing: a tool payload is a `JsonValue` on
 * arrival and a validated domain type after its Zod schema has run. The point
 * is to name the gap, not to close it — which is the one thing `unknown` at
 * these boundaries could not do.
 */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

/** A JSON object — the shape every tool-call argument payload arrives in. */
export type JsonRecord = { [key: string]: JsonValue };

/**
 * A value on its way INTO `JSON.stringify` — `JsonValue` plus the two things
 * every domain row here carries: `Date` columns and optional fields.
 *
 * Separate from `JsonValue` on purpose: that one describes what came out of a
 * parse, where a date is already a string. Conflating them is how a `Date` gets
 * treated as one a call before it actually becomes one.
 */
export type Serializable =
	| string
	| number
	| boolean
	| null
	| undefined
	| Date
	| Serializable[]
	| { [key: string]: Serializable };
