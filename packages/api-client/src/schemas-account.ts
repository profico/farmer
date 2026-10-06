/**
 * The answers of the routes for a person's own sign-ins and API tokens. The
 * rules of `schemas.ts` apply: an unknown field is dropped, and a value from
 * an open set is read as a string.
 */

import { z } from "zod";

import type { Expect, Parses } from "./contract";
import type { components } from "./openapi.gen";

type Schemas = components["schemas"];

export const sessionSchema = z.object({
	id: z.string(),
	/** "Farmer app on Android", "Chrome on macOS". */
	label: z.string(),
	/** `cli`, `browser` or `mobile`. */
	kind: z.string(),
	ipAddress: z.string().nullable(),
	/** An instant, ISO 8601 in UTC. */
	createdAt: z.string(),
	/** When the session was last renewed. */
	updatedAt: z.string(),
	/** An instant, ISO 8601 in UTC. */
	expiresAt: z.string(),
	/** The session of this request. */
	isCurrent: z.boolean(),
});
export type Session = z.output<typeof sessionSchema>;

export const revokedSchema = z.object({
	/** False when the row was already gone. */
	revoked: z.boolean(),
});
export type Revoked = z.output<typeof revokedSchema>;

export const personalTokenSchema = z.object({
	id: z.string(),
	name: z.string(),
	/** The last four characters of the token. */
	hint: z.string(),
	/** `read` or `write`. */
	scope: z.string(),
	/** The workspace the token is bound to, or null for all of them. */
	workspace: z.object({ slug: z.string(), name: z.string() }).nullable(),
	/** An instant, ISO 8601 in UTC. */
	createdAt: z.string(),
	lastUsedAt: z.string().nullable(),
	/** Null for a token that never expires. */
	expiresAt: z.string().nullable(),
	expired: z.boolean(),
});
export type PersonalToken = z.output<typeof personalTokenSchema>;

export const personalTokenCreatedSchema = z.object({
	/** The token. Readable only in this answer. */
	token: z.string(),
	apiToken: personalTokenSchema,
});
export type PersonalTokenCreated = z.output<typeof personalTokenCreatedSchema>;

// Each answer the document describes must parse with the schema above.
export type AccountContractChecks = [
	Expect<Parses<Schemas["Session"], typeof sessionSchema>>,
	Expect<Parses<Schemas["Revoked"], typeof revokedSchema>>,
	Expect<Parses<Schemas["PersonalToken"], typeof personalTokenSchema>>,
	Expect<
		Parses<Schemas["PersonalTokenCreated"], typeof personalTokenCreatedSchema>
	>,
];
