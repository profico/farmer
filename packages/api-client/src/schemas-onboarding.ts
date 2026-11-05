/**
 * The answers of `/api/v1/me/...` for a person before a workspace: the
 * invitations to them, a Harvest import's claims on them, and a new
 * workspace. The rules of `schemas.ts` apply.
 *
 * The writes here need a session credential (`farmer login` or the mobile
 * sign-in). An API token gets 403.
 */

import { z } from "zod";

import type { Expect, Parses } from "./contract";
import type { components } from "./openapi.gen";

type Schemas = components["schemas"];

export const myInvitationSchema = z.object({
	id: z.string(),
	role: z.string().nullable(),
	organization: z.object({ id: z.string(), name: z.string() }),
	/** An instant, ISO 8601. */
	expiresAt: z.string(),
});
export type MyInvitation = z.output<typeof myInvitationSchema>;

/** The workspace to open after an accept. */
export const joinedOrganizationSchema = z.object({
	organizationId: z.string(),
	slug: z.string(),
});
export type JoinedOrganization = z.output<typeof joinedOrganizationSchema>;

export const importClaimSchema = z.object({
	organizationId: z.string(),
	name: z.string(),
	slug: z.string(),
	logo: z.string().nullable(),
	/** When the import made the membership, ISO 8601. */
	since: z.string(),
});
export type ImportClaim = z.output<typeof importClaimSchema>;

export const createdOrganizationSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
});
export type CreatedOrganization = z.output<typeof createdOrganizationSchema>;

// Each answer the document describes must parse with the schema above.
export type OnboardingContractChecks = [
	Expect<Parses<Schemas["MyInvitation"], typeof myInvitationSchema>>,
	Expect<
		Parses<Schemas["JoinedOrganization"], typeof joinedOrganizationSchema>
	>,
	Expect<Parses<Schemas["ImportClaim"], typeof importClaimSchema>>,
	Expect<
		Parses<Schemas["CreatedOrganization"], typeof createdOrganizationSchema>
	>,
];
