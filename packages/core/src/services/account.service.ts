import { and, eq } from "drizzle-orm";

import { googleCredentials, signInProviders } from "../auth/sign-in-methods";
import { db } from "../db";
import { account } from "../db/schema/auth";
import { recordSecurityEvent } from "./audit";
import type { Ctx } from "./types";

// Sign-in methods = how the user authenticates, distinct from the GitHub/Google
// *integration* connections (those enrich time entries and live on the
// Integrations page). We surface only credential + Google here: "github" and
// "google-calendar" account rows exist for data access, not login, so they're
// deliberately excluded.
export type SignInMethods = {
	// A "credential" account row means an email/password is set. Needed so the UI
	// can block unlinking the last social method into a lockout.
	hasPassword: boolean;
	/** `configured`: the instance has Google credentials, so a Connect button
	 *  can work. A linked row outlives the credentials, so both are reported. */
	google: { linked: boolean; configured: boolean };
	/** The OpenID Connect sources that are switched on, from the
	 *  Infrastructure page. The first account, created with a password on an
	 *  instance with no provider, connects one here; see
	 *  `auth/sign-in-methods.ts`. */
	providers: { id: string; name: string; linked: boolean }[];
};

/** The account rows that connect an integration, not a way to sign in. */
export type IntegrationProvider = "github" | "google-calendar";

export const accountService = {
	signInMethods: async (ctx: Ctx): Promise<SignInMethods> => {
		// Read the account table directly rather than auth.api.listUserAccounts,
		// which needs a request session — this runs behind a server function with
		// only ctx (mirrors github/google-calendar connectionStatus).
		const rows = await db.query.account.findMany({
			where: eq(account.userId, ctx.userId),
			columns: { providerId: true },
		});
		const providers = new Set(rows.map((row) => row.providerId));
		return {
			hasPassword: providers.has("credential"),
			google: {
				linked: providers.has("google"),
				configured: googleCredentials() !== null,
			},
			providers: signInProviders()
				.filter((provider) => provider.id !== "google")
				.map((provider) => ({
					...provider,
					linked: providers.has(provider.id),
				})),
		};
	},

	/**
	 * Disconnect the caller's GitHub or Google Calendar grant. The web page
	 * does this through better-auth's `/unlink-account`, which needs a browser
	 * session; the REST API has only a `Ctx`, so it comes here.
	 *
	 * The same rule as better-auth: the last account row of a person is
	 * refused, because without it the person has no way to sign in. Only the
	 * two integration providers are accepted, so this can never remove the
	 * Google sign-in row (that is `unlinkGoogle`, with its own rule).
	 *
	 * Not in the audit log: an integration grant is not a sign-in method (see
	 * `docs/domains/audit-log.md`). Answers whether a row was removed.
	 */
	unlinkIntegration: async (
		ctx: Ctx,
		providerId: IntegrationProvider,
	): Promise<boolean> => {
		const rows = await db.query.account.findMany({
			where: eq(account.userId, ctx.userId),
			columns: { providerId: true },
		});
		if (!rows.some((row) => row.providerId === providerId)) return false;
		if (rows.length === 1) {
			throw new Error(
				"This is your only way to sign in. Add another sign-in method before you disconnect it.",
			);
		}
		const removed = await db
			.delete(account)
			.where(
				and(eq(account.userId, ctx.userId), eq(account.providerId, providerId)),
			)
			.returning({ id: account.id });
		return removed.length > 0;
	},

	// Guarded server-side unlink for the Google login identity. Refuses to remove
	// the user's only remaining sign-in method (a Google-only account with no
	// password) so they can't lock themselves out — the UI mirrors this, but the
	// check lives here too so the rule holds regardless of caller.
	unlinkGoogle: async (ctx: Ctx): Promise<void> => {
		const rows = await db.query.account.findMany({
			where: eq(account.userId, ctx.userId),
			columns: { providerId: true },
		});
		const providers = new Set(rows.map((row) => row.providerId));
		if (!providers.has("google")) return;
		if (!providers.has("credential")) {
			throw new Error(
				"Set a password before disconnecting Google — it's your only way to sign in.",
			);
		}
		const removed = await db
			.delete(account)
			.where(
				and(eq(account.userId, ctx.userId), eq(account.providerId, "google")),
			)
			.returning({ id: account.id });
		// The one place a sign-in method is disconnected. better-auth's
		// `/unlink-account` is reached only for the GitHub and Google Calendar
		// grants, which are integrations, not ways in (see `account.linked` in
		// `auth/index.ts`, which skips them for the same reason).
		for (const row of removed) {
			await recordSecurityEvent({
				kind: "account.unlinked",
				subjectUserId: ctx.userId,
				actorUserId: ctx.userId,
				actor: ctx.actor,
				target: { type: "account", id: row.id, label: "google" },
			});
		}
	},
};
