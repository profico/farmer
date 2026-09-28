import { sql } from "drizzle-orm";
import {
	check,
	index,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

const ts = (name: string) =>
	timestamp(name, { withTimezone: true, mode: "date" });

// Personal API tokens (Preferences → API tokens), for a script that cannot run
// the CLI's device flow. See `docs/domains/api-tokens.md`.
//
// **Keyed on the person, and tenanted only when the person asked for it.** A
// token acts as its owner, and the owner can be in several workspaces, so
// `organization_id` is null for a token that may name any of them. When it is
// set, the token answers for that one workspace and a request naming another
// is refused like an unknown slug. Either way a request still passes the same
// membership check a device-flow token does, so a token outlives nothing: an
// ex-member's token is a 401.
//
// **Only the SHA-256 of the token is stored.** The token is shown once, when
// it is made, and never again; a database dump holds nothing that can call the
// API. A plain hash is enough, unlike a password: the token is 32 random
// bytes, so there is nothing to guess and nothing a slow hash would protect.
// `hint` is the last four characters, which is all the list shows.
//
// A revoked token is deleted rather than marked. Nothing reads a revoked
// token, and a row that no longer authenticates is not a history anybody asked
// for.
export const apiToken = pgTable(
	"api_token",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		organizationId: text("organization_id").references(() => organization.id, {
			onDelete: "cascade",
		}),
		name: text("name").notNull(),
		tokenHash: text("token_hash").notNull().unique(),
		hint: text("hint").notNull(),
		/** `read` or `write` — see `API_TOKEN_SCOPES` in `api/tokens.ts`. */
		scope: text("scope").notNull(),
		/** Null never expires. */
		expiresAt: ts("expires_at"),
		/** Moved at most once a minute (`apiTokensService.authenticate`), so a
		 *  script that calls in a loop does not write a row per request. */
		lastUsedAt: ts("last_used_at"),
		createdAt: ts("created_at").notNull().defaultNow(),
	},
	(t) => [
		index("api_token_user_idx").on(t.userId),
		check("api_token_scope_check", sql`${t.scope} in ('read', 'write')`),
	],
);
