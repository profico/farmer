/**
 * The person's own sign-ins and API tokens, as the REST API answers them:
 * Preferences → Signed-in devices and Preferences → API tokens.
 *
 * Both belong to the person and not to a workspace. Neither projection ever
 * carries a credential: a session is listed without its token, and an API
 * token is listed with its last four characters (`hint`). The one time a
 * token is readable is the answer of its creation.
 */

import type { ApiTokenScope } from "./tokens";

/** What holds the session. The server reads it from the `User-Agent`, so it
 *  is a label for a person, and nothing decides access from it. */
export type ApiSessionKind = "cli" | "browser" | "mobile";

type SessionSource = {
	id: string;
	label: string;
	kind: ApiSessionKind;
	ipAddress: string | null;
	createdAt: Date;
	updatedAt: Date;
	expiresAt: Date;
	isCurrent: boolean;
};

/** One row of `GET /me/sessions`. */
export type ApiSession = {
	id: string;
	/** "Farmer app on Android", "Chrome on macOS", "Farmer CLI (linux x64)". */
	label: string;
	kind: ApiSessionKind;
	ipAddress: string | null;
	/** ISO 8601, UTC. */
	createdAt: string;
	/** When the session was last renewed, at most once a day. */
	updatedAt: string;
	/** ISO 8601, UTC. */
	expiresAt: string;
	/** The session the request was made with. False for each row when the
	 *  request has no session, as with a cookie that no session token names. */
	isCurrent: boolean;
};

export const toApiSession = (row: SessionSource): ApiSession => ({
	id: row.id,
	label: row.label,
	kind: row.kind,
	ipAddress: row.ipAddress,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	expiresAt: row.expiresAt.toISOString(),
	isCurrent: row.isCurrent,
});

/** `DELETE /me/sessions/$id` and `DELETE /orgs/$slug/api-tokens/$id`.
 *  `false` is a row that was already gone, which is not an error. */
export type ApiRevoked = { revoked: boolean };

type ApiTokenSource = {
	id: string;
	name: string;
	hint: string;
	scope: ApiTokenScope;
	organization: { slug: string; name: string } | null;
	createdAt: Date;
	lastUsedAt: Date | null;
	expiresAt: Date | null;
	expired: boolean;
};

/** One row of `GET /orgs/$slug/api-tokens`. */
export type ApiPersonalToken = {
	id: string;
	name: string;
	/** The last four characters, to match a token in a script's config. */
	hint: string;
	scope: ApiTokenScope;
	/** The workspace the token is bound to, or null for all of them. */
	workspace: { slug: string; name: string } | null;
	/** ISO 8601, UTC. */
	createdAt: string;
	lastUsedAt: string | null;
	/** Null for a token that never expires. */
	expiresAt: string | null;
	expired: boolean;
};

export const toApiPersonalToken = (row: ApiTokenSource): ApiPersonalToken => ({
	id: row.id,
	name: row.name,
	hint: row.hint,
	scope: row.scope,
	workspace: row.organization
		? { slug: row.organization.slug, name: row.organization.name }
		: null,
	createdAt: row.createdAt.toISOString(),
	lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
	expiresAt: row.expiresAt?.toISOString() ?? null,
	expired: row.expired,
});

/** `POST /orgs/$slug/api-tokens`. */
export type ApiPersonalTokenCreated = {
	/** The token. Readable only in this answer. */
	token: string;
	apiToken: ApiPersonalToken;
};
