/**
 * Settings → People: the people of a workspace, their invitations and the
 * team lead lists. Admins only, except a team lead's own list.
 *
 * A personnel record holds an email, a person type and a start date, so the
 * routes check the admin role before they read. These projections name each
 * field, so a new column does not reach a client by accident.
 */

import type { MemberTypeValue } from "../schema/members";
import type {
	InvitationEmailState,
	PersonRow,
} from "../services/members.service";
import { type ApiPersonRef, toApiPersonRef } from "./project-admin";

/** `GET /api/v1/orgs/$slug/people` — one row of the People page. */
export type ApiPerson = {
	userId: string;
	name: string;
	email: string;
	/** `owner`, `admin` or `member`. */
	orgRole: string;
	type: MemberTypeValue;
	/** The monthly target of an hourly person, in seconds, or null. */
	expectedSecondsOverride: number | null;
	/** yyyy-MM-dd, or null. */
	startDate: string | null;
	/** ISO 8601, or null for an active person. */
	archivedAt: string | null;
	/** Never signed in, and nobody confirmed the address. */
	emailUnconfirmed: boolean;
	/** A Harvest import added them, and they have not joined yet. */
	claimPending: boolean;
	/** The number of people on their team lead list. */
	leadsPeople: number;
};

export const toApiPerson = (row: PersonRow): ApiPerson => ({
	userId: row.userId,
	name: row.name,
	email: row.email,
	orgRole: row.orgRole,
	type: row.type,
	expectedSecondsOverride: row.expectedSecondsOverride,
	startDate: row.startDate,
	archivedAt: row.archivedAt?.toISOString() ?? null,
	emailUnconfirmed: row.emailUnconfirmed,
	claimPending: row.claimPending,
	leadsPeople: row.leadsPeople,
});

/** One segment of a person's type history. `effectiveUntil` is exclusive,
 *  and null for the current segment. */
export type ApiPersonTypeSegment = {
	type: MemberTypeValue;
	expectedSecondsOverride: number | null;
	effectiveFrom: string;
	effectiveUntil: string | null;
};

/** `GET /api/v1/orgs/$slug/people/$userId` — one person, with the history
 *  of their type and the people on their team lead list. */
export type ApiPersonProfile = {
	person: ApiPerson;
	typeHistory: ApiPersonTypeSegment[];
	leads: ApiPersonRef[];
};

export const toApiPersonProfile = (profile: {
	person: PersonRow;
	typeHistory: ApiPersonTypeSegment[];
	leads: ApiPersonRef[];
}): ApiPersonProfile => ({
	person: toApiPerson(profile.person),
	typeHistory: profile.typeHistory.map((segment) => ({
		type: segment.type,
		expectedSecondsOverride: segment.expectedSecondsOverride,
		effectiveFrom: segment.effectiveFrom,
		effectiveUntil: segment.effectiveUntil,
	})),
	leads: profile.leads.map(toApiPersonRef),
});

/** The answer to an archive or a restore. A restore of a person who never
 *  signed in also confirms their address, and this says whether it did. */
export type ApiArchiveResult = { emailConfirmed: boolean };

/** `GET /api/v1/orgs/$slug/invitations` — a pending invitation. */
export type ApiInvitation = {
	id: string;
	email: string;
	role: string | null;
	status: string;
	/** ISO 8601. */
	expiresAt: string;
	createdAt: string;
	/** Where the invitation email stands, or null for an invitation made
	 *  before the delivery was tracked. */
	emailDelivery: InvitationEmailState | null;
};

export const toApiInvitation = (row: {
	id: string;
	email: string;
	role: string | null;
	status: string;
	expiresAt: Date;
	createdAt: Date;
	emailDelivery: InvitationEmailState | null;
}): ApiInvitation => ({
	id: row.id,
	email: row.email,
	role: row.role,
	status: row.status,
	expiresAt: row.expiresAt.toISOString(),
	createdAt: row.createdAt.toISOString(),
	emailDelivery: row.emailDelivery
		? { status: row.emailDelivery.status, error: row.emailDelivery.error }
		: null,
});
