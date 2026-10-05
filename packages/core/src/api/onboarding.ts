/**
 * The routes of a person before a workspace: `/api/v1/me/...`. The invitations
 * to them, a Harvest import's pending claims on them, and a new workspace.
 * The web app shows the same on `/no-access` and in the org switcher.
 */

/** `GET /api/v1/me/invitations` — a live invitation to the caller's
 *  address. */
export type ApiMyInvitation = {
	id: string;
	role: string | null;
	organization: { id: string; name: string };
	expiresAt: string;
};

export const toApiMyInvitation = (row: {
	id: string;
	role: string | null;
	organizationId: string;
	organizationName: string;
	expiresAt: Date;
}): ApiMyInvitation => ({
	id: row.id,
	role: row.role,
	organization: { id: row.organizationId, name: row.organizationName },
	expiresAt: row.expiresAt.toISOString(),
});

/** The workspace that the caller can open now: an invitation or a claim
 *  that they accepted. */
export type ApiJoinedOrganization = { organizationId: string; slug: string };

/** `GET /api/v1/me/import-claims` — a workspace whose Harvest import made a
 *  membership for the caller, which waits for their answer. */
export type ApiImportClaim = {
	organizationId: string;
	name: string;
	slug: string;
	logo: string | null;
	/** When the import made the membership. */
	since: string;
};

export const toApiImportClaim = (row: {
	organizationId: string;
	name: string;
	slug: string;
	logo: string | null;
	since: Date;
}): ApiImportClaim => ({
	organizationId: row.organizationId,
	name: row.name,
	slug: row.slug,
	logo: row.logo,
	since: row.since.toISOString(),
});

/** `POST /api/v1/me/organizations` — the new workspace. The caller owns it. */
export type ApiCreatedOrganization = { id: string; name: string; slug: string };
