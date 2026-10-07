import { createHash, randomBytes } from "node:crypto";

import { and, asc, count, eq, isNull, lt, or } from "drizzle-orm";

import { API_TOKEN_PREFIX, type ApiTokenScope } from "../api/tokens";
import { db } from "../db";
import { apiToken } from "../db/schema/api-tokens";
import { organization, user } from "../db/schema/auth";
import { isBanned } from "../lib/ban";
import { loggableError } from "../lib/loggable-error";
import { UserFacingError } from "../lib/user-facing-error";
import type { CreateApiTokenInput } from "../schema/api-tokens";
import { recordSecurityEvent } from "./audit";
import type { Ctx, CtxActor } from "./types";

/**
 * Preferences → API tokens: long-lived credentials a person makes for a script.
 *
 * The CLI's device flow stays what it is — a session a person approves in a
 * browser. A token is for what cannot do that: a cron job, a CI step, a
 * spreadsheet that pulls last month. See `docs/domains/api-tokens.md`.
 *
 * **Tokens belong to a person, not to an organization**, like sessions. The
 * functions that manage them take a `Ctx` and read `ctx.userId` from it, for
 * the reason `sessions.service.ts` gives; `ctx.organizationId` is read only
 * when a new token is bound to the workspace it was made in. `authenticate` is
 * the one function without a `Ctx`, because it is what turns a request into
 * one: it answers "whose token is this", and `orgContextService.resolveBySlug`
 * answers "may they speak for that workspace", exactly as for a device-flow
 * token.
 */

/** A person's limit. Generous for any real use, and a ceiling on how many
 *  rows one account can make the list and the table hold. */
export const MAX_API_TOKENS_PER_USER = 50;

/** How stale `last_used_at` may get before a request moves it. */
const LAST_USED_RESOLUTION_MS = 60_000;

const DAY_MS = 86_400_000;

/** One row of the list. Never the token or its hash. */
export type MyApiToken = {
	id: string;
	name: string;
	/** The last four characters, to match a token in a script's config. */
	hint: string;
	scope: ApiTokenScope;
	/** The workspace the token is bound to, or null for all of them. */
	organization: { slug: string; name: string } | null;
	createdAt: Date;
	lastUsedAt: Date | null;
	expiresAt: Date | null;
	expired: boolean;
};

/** The person behind a valid token, and what the token lets them do. */
export type ApiTokenPrincipal = {
	tokenId: string;
	userId: string;
	user: { id: string; name: string; email: string };
	scope: ApiTokenScope;
	/** Set when the token answers for one workspace only. */
	organizationId: string | null;
};

export class ApiTokenLimitError extends UserFacingError {
	constructor() {
		super(
			`You have ${MAX_API_TOKENS_PER_USER} API tokens, which is the limit. Revoke one you no longer use first.`,
		);
		this.name = "ApiTokenLimitError";
	}
}

/** Stored as text with a check constraint; this is the read side of it. */
const scopeOf = (value: string): ApiTokenScope =>
	value === "write" ? "write" : "read";

export const hashApiToken = (token: string): string =>
	createHash("sha256").update(token, "utf8").digest("hex");

/** 32 random bytes is 43 base64url characters after the prefix. */
export const generateApiToken = (): string =>
	`${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;

/** What a revoke reads back from the deleted row, for `api_token.revoked`,
 *  which is written in the token's workspace when it was bound to one. */
const revokedColumns = {
	id: apiToken.id,
	name: apiToken.name,
	organizationId: apiToken.organizationId,
};

export const apiTokensService = {
	/**
	 * The caller's tokens, oldest first — the order they were made in, which
	 * does not move as they are used. An expired token is listed and marked:
	 * unlike a session it did not end on its own schedule, and a person whose
	 * script just stopped working needs to see why.
	 */
	listMine: async (
		ctx: Ctx,
		{ now = new Date() }: { now?: Date } = {},
	): Promise<MyApiToken[]> => {
		const rows = await db
			.select({
				id: apiToken.id,
				name: apiToken.name,
				hint: apiToken.hint,
				scope: apiToken.scope,
				createdAt: apiToken.createdAt,
				lastUsedAt: apiToken.lastUsedAt,
				expiresAt: apiToken.expiresAt,
				orgSlug: organization.slug,
				orgName: organization.name,
			})
			.from(apiToken)
			.leftJoin(organization, eq(organization.id, apiToken.organizationId))
			.where(eq(apiToken.userId, ctx.userId))
			.orderBy(asc(apiToken.createdAt), asc(apiToken.id));

		return rows.map(({ orgSlug, orgName, scope, ...row }) => ({
			...row,
			scope: scopeOf(scope),
			organization:
				orgSlug !== null && orgName !== null
					? { slug: orgSlug, name: orgName }
					: null,
			expired: row.expiresAt !== null && row.expiresAt <= now,
		}));
	},

	/**
	 * Make a token. The returned `token` is the only time it exists outside the
	 * caller's hands: the table keeps its hash.
	 */
	create: async (
		ctx: Ctx,
		input: CreateApiTokenInput,
		{ now = new Date() }: { now?: Date } = {},
	): Promise<{ token: string; apiToken: MyApiToken }> => {
		const [held] = await db
			.select({ n: count() })
			.from(apiToken)
			.where(eq(apiToken.userId, ctx.userId));
		if ((held?.n ?? 0) >= MAX_API_TOKENS_PER_USER) {
			throw new ApiTokenLimitError();
		}

		const token = generateApiToken();
		const expiresAt =
			input.expiresInDays === null
				? null
				: new Date(now.getTime() + input.expiresInDays * DAY_MS);
		const organizationId =
			input.workspace === "this" ? ctx.organizationId : null;

		const [row] = await db
			.insert(apiToken)
			.values({
				userId: ctx.userId,
				organizationId,
				name: input.name,
				tokenHash: hashApiToken(token),
				hint: token.slice(-4),
				scope: input.scope,
				expiresAt,
				createdAt: now,
			})
			.returning({ id: apiToken.id });
		if (!row) throw new Error("The token was not saved.");

		// A security event rather than a change: a token is a way in. A token
		// bound to one workspace is news there only.
		await recordSecurityEvent({
			kind: "api_token.created",
			subjectUserId: ctx.userId,
			actorUserId: ctx.userId,
			actor: ctx.actor,
			organizationId,
			target: { type: "api_token", id: row.id, label: input.name },
			details: {
				scope: input.scope,
				expiresInDays: input.expiresInDays,
				workspace: input.workspace,
			},
		});

		const org = organizationId
			? await db.query.organization.findFirst({
					where: eq(organization.id, organizationId),
					columns: { slug: true, name: true },
				})
			: null;

		return {
			token,
			apiToken: {
				id: row.id,
				name: input.name,
				hint: token.slice(-4),
				scope: input.scope,
				organization: org ?? null,
				createdAt: now,
				lastUsedAt: null,
				expiresAt,
				expired: false,
			},
		};
	},

	/**
	 * Revoke one of the caller's tokens. The delete names both the id and
	 * `ctx.userId`, so another person's token id deletes nothing, and "not
	 * yours" and "no such token" are one answer, as in `sessionsService.revoke`.
	 * The next request with the token is a 401.
	 */
	revoke: async (ctx: Ctx, tokenId: string): Promise<{ revoked: boolean }> => {
		const deleted = await db
			.delete(apiToken)
			.where(and(eq(apiToken.id, tokenId), eq(apiToken.userId, ctx.userId)))
			.returning(revokedColumns);
		for (const token of deleted) {
			await recordSecurityEvent({
				kind: "api_token.revoked",
				subjectUserId: ctx.userId,
				actorUserId: ctx.userId,
				actor: ctx.actor,
				organizationId: token.organizationId,
				target: { type: "api_token", id: token.id, label: token.name },
			});
		}
		return { revoked: deleted.length > 0 };
	},

	/**
	 * The person a token belongs to, or null for a token that matches no row or
	 * has expired.
	 *
	 * Also moves `last_used_at`, at most once a minute per token. The update is
	 * conditional in SQL rather than decided here, so two requests that arrive
	 * together write once. A failed update is logged and ignored: the request
	 * is authenticated either way, and the column is a courtesy.
	 */
	authenticate: async (
		token: string,
		{ now = new Date() }: { now?: Date } = {},
	): Promise<ApiTokenPrincipal | null> => {
		const [row] = await db
			.select({
				tokenId: apiToken.id,
				scope: apiToken.scope,
				organizationId: apiToken.organizationId,
				expiresAt: apiToken.expiresAt,
				lastUsedAt: apiToken.lastUsedAt,
				userId: user.id,
				name: user.name,
				email: user.email,
				banned: user.banned,
				banExpires: user.banExpires,
			})
			.from(apiToken)
			.innerJoin(user, eq(user.id, apiToken.userId))
			.where(eq(apiToken.tokenHash, hashApiToken(token)))
			.limit(1);
		if (!row) return null;
		if (row.expiresAt !== null && row.expiresAt <= now) return null;
		// A ban stops the token, as it stops a sign-in. The token stays in
		// the table, so it works again when the ban ends.
		if (isBanned(row, now)) return null;

		const stale = new Date(now.getTime() - LAST_USED_RESOLUTION_MS);
		if (row.lastUsedAt === null || row.lastUsedAt < stale) {
			try {
				await db
					.update(apiToken)
					.set({ lastUsedAt: now })
					.where(
						and(
							eq(apiToken.id, row.tokenId),
							or(isNull(apiToken.lastUsedAt), lt(apiToken.lastUsedAt, stale)),
						),
					);
			} catch (error) {
				console.error(
					"[api-tokens] could not record a token's use",
					loggableError(error),
				);
			}
		}

		return {
			tokenId: row.tokenId,
			userId: row.userId,
			user: { id: row.userId, name: row.name, email: row.email },
			scope: scopeOf(row.scope),
			organizationId: row.organizationId,
		};
	},

	/**
	 * Revoke the token a request was made with — `DELETE /api/v1/session`
	 * called with an API token. No `Ctx`: the caller proved who they are by
	 * holding the token, and the id came from `authenticate`. `actor` is the
	 * audit log's record of the request; by default, the token itself.
	 */
	revokePresented: async (
		principal: ApiTokenPrincipal,
		actor: CtxActor = { via: "api_token", apiTokenId: principal.tokenId },
	): Promise<void> => {
		const deleted = await db
			.delete(apiToken)
			.where(
				and(
					eq(apiToken.id, principal.tokenId),
					eq(apiToken.userId, principal.userId),
				),
			)
			.returning(revokedColumns);
		for (const token of deleted) {
			await recordSecurityEvent({
				kind: "api_token.revoked",
				subjectUserId: principal.userId,
				actorUserId: principal.userId,
				actor,
				organizationId: token.organizationId,
				target: { type: "api_token", id: token.id, label: token.name },
			});
		}
	},
};
