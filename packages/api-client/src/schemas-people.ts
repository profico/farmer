/**
 * The answers of the routes for project settings, the team, clients and people. The rules of
 * `schemas.ts` apply: an unknown field is dropped, and a value from an open
 * set is read as a string.
 */

import { z } from "zod";

import type { Expect, Parses } from "./contract";
import type { components } from "./openapi.gen";

type Schemas = components["schemas"];

export const clientSchema = z.object({
	id: z.string(),
	name: z.string(),
	/** True for the organization's own client. */
	isInternal: z.boolean(),
	/** Null for an active client. */
	archivedAt: z.string().nullable(),
});
export type Client = z.output<typeof clientSchema>;

export const personRefSchema = z.object({
	userId: z.string(),
	name: z.string(),
	email: z.string(),
});
export type PersonRef = z.output<typeof personRefSchema>;

export const projectMemberSchema = z.object({
	userId: z.string(),
	name: z.string(),
	email: z.string(),
	role: z.string(),
	/** False for a person who was removed. Their hours stay. */
	active: z.boolean(),
	allTimeSeconds: z.number(),
	/** A day, yyyy-MM-dd. */
	lastEntry: z.string().nullable(),
});
export type ProjectMember = z.output<typeof projectMemberSchema>;

export const personSchema = z.object({
	userId: z.string(),
	name: z.string(),
	email: z.string(),
	/** `owner`, `admin` or `member`. */
	orgRole: z.string(),
	type: z.string(),
	/** The monthly target of an hourly person, or null. */
	expectedSecondsOverride: z.number().nullable(),
	/** A day, yyyy-MM-dd. */
	startDate: z.string().nullable(),
	/** Null for an active person. */
	archivedAt: z.string().nullable(),
	/** Never signed in, and nobody confirmed the address. */
	emailUnconfirmed: z.boolean(),
	/** A Harvest import added them, and they have not joined. */
	claimPending: z.boolean(),
	/** The number of people on their team lead list. */
	leadsPeople: z.number(),
});
export type Person = z.output<typeof personSchema>;

export const personProfileSchema = z.object({
	person: personSchema,
	/** Oldest first. */
	typeHistory: z.array(
		z.object({
			type: z.string(),
			expectedSecondsOverride: z.number().nullable(),
			/** A day, yyyy-MM-dd. */
			effectiveFrom: z.string(),
			/** Exclusive. Null for the current type. */
			effectiveUntil: z.string().nullable(),
		}),
	),
	/** The people on their team lead list. */
	leads: z.array(personRefSchema),
});
export type PersonProfile = z.output<typeof personProfileSchema>;

export const archiveResultSchema = z.object({
	/** True when the call also confirmed the person's address. */
	emailConfirmed: z.boolean(),
});
export type ArchiveResult = z.output<typeof archiveResultSchema>;

export const invitationSchema = z.object({
	id: z.string(),
	email: z.string(),
	role: z.string().nullable(),
	status: z.string(),
	/** An instant, ISO 8601 in UTC. */
	expiresAt: z.string(),
	/** An instant, ISO 8601 in UTC. */
	createdAt: z.string(),
	/** Null for an invitation from before delivery was tracked. */
	emailDelivery: z
		.object({
			status: z.string(),
			error: z.string().nullable(),
		})
		.nullable(),
});
export type Invitation = z.output<typeof invitationSchema>;

// Each answer the document describes must parse with the schema above.
export type PeopleContractChecks = [
	Expect<Parses<Schemas["Client"], typeof clientSchema>>,
	Expect<Parses<Schemas["PersonRef"], typeof personRefSchema>>,
	Expect<Parses<Schemas["ProjectMember"], typeof projectMemberSchema>>,
	Expect<Parses<Schemas["Person"], typeof personSchema>>,
	Expect<Parses<Schemas["PersonProfile"], typeof personProfileSchema>>,
	Expect<Parses<Schemas["ArchiveResult"], typeof archiveResultSchema>>,
	Expect<Parses<Schemas["Invitation"], typeof invitationSchema>>,
];
