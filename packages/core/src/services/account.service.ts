import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { account } from "../db/schema/auth";
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
	google: { linked: boolean };
};

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
			google: { linked: providers.has("google") },
		};
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
		await db
			.delete(account)
			.where(
				and(eq(account.userId, ctx.userId), eq(account.providerId, "google")),
			);
	},
};
