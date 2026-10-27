import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { oauthAccessToken, user } from "../db/schema/auth";
import { isBanned } from "../lib/ban";

/**
 * An MCP access token outlives a ban unless something removes it.
 * better-auth's `getMcpSession` checks only that the token row exists, and
 * the `refresh_token` grant mints a new access token with no ban check.
 *
 * Three places close that gap:
 * - `resolveMcpOrgContext` (`apps/web/src/server/api-auth.ts`) refuses a
 *   banned person on each request.
 * - `revokeMcpTokens` deletes the rows when an admin bans a person, or when
 *   all sessions of a person end. A plain sign-out of one browser does not
 *   call it.
 * - `assertRefreshAllowed` refuses a refresh for a banned person.
 */
/** The admin endpoints that end a person's access, and the body field they share. */
export const ADMIN_REVOKE_PATHS = new Set([
	"/admin/ban-user",
	"/admin/revoke-user-sessions",
]);
export const adminTargetBody = z.object({ userId: z.string() });

export const revokeMcpTokens = async (userId: string) => {
	await db.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, userId));
};

/** Refuse a `refresh_token` grant when its owner is banned. */
export const assertRefreshAllowed = async (refreshToken: string | null) => {
	if (!refreshToken) return;
	const [owner] = await db
		.select({ banned: user.banned, banExpires: user.banExpires })
		.from(oauthAccessToken)
		.innerJoin(user, eq(user.id, oauthAccessToken.userId))
		.where(eq(oauthAccessToken.refreshToken, refreshToken));
	// An unknown token: the endpoint answers `invalid_grant` itself.
	if (!owner || !isBanned(owner)) return;
	throw new APIError("UNAUTHORIZED", {
		error: "invalid_grant",
		error_description: "This account is banned.",
	});
};
