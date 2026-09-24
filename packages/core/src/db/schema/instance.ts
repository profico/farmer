import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";

const ts = (name: string) =>
	timestamp(name, { withTimezone: true, mode: "date" });

// The instance's configuration, one row per setting. The key is the setting's
// environment variable (see `lib/instance-settings.ts`); a missing row means
// "not set here", and the environment or the default answers. A secret is
// stored sealed by `lib/secret-box.ts`, never in the clear.
//
// No organization column: these belong to the deployment. The only writer is
// `instanceSettingsService`, behind `platformAdminMiddleware`.
export const instanceSetting = pgTable("instance_setting", {
	name: text("name").primaryKey(),
	value: text("value").notNull(),
	updatedAt: ts("updated_at").notNull().defaultNow(),
	updatedBy: text("updated_by").references(() => user.id, {
		onDelete: "set null",
	}),
});

// A sign-in source a platform admin added on the Infrastructure page: any
// OpenID Connect provider (Authentik, Zitadel, Keycloak, GitLab and so on).
// Registered with better-auth's `genericOAuth` when the auth instance is built.
// `providerId` is the path segment of its callback URL, so it never changes
// after the row exists. `clientSecret` is sealed by `lib/secret-box.ts`.
export const instanceOAuthProvider = pgTable("instance_oauth_provider", {
	id: uuid("id").primaryKey().defaultRandom(),
	providerId: text("provider_id").notNull().unique(),
	name: text("name").notNull(),
	/** The issuer's base URL. `/.well-known/openid-configuration` is read from
	 *  it, unless the URL already ends in that path. */
	baseUrl: text("base_url").notNull(),
	clientId: text("client_id").notNull(),
	clientSecret: text("client_secret").notNull(),
	/** Space-separated. `openid email profile` when empty. */
	scopes: text("scopes").notNull().default(""),
	enabled: boolean("enabled").notNull().default(true),
	/** The source checks every address it hands out, so a sign-in through it
	 *  counts as a verified address even without an `email_verified` claim. */
	trustsEmail: boolean("trusts_email").notNull().default(false),
	createdAt: ts("created_at").notNull().defaultNow(),
	updatedAt: ts("updated_at").notNull().defaultNow(),
});
