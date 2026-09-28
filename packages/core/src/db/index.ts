import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as apiTokensSchema from "./schema/api-tokens";
import * as assistantSchema from "./schema/assistant";
import * as authSchema from "./schema/auth";
import * as domainSchema from "./schema/domain";
import * as githubSchema from "./schema/github";
import * as importSchema from "./schema/import";
import * as instanceSchema from "./schema/instance";
import * as notificationsSchema from "./schema/notifications";
import * as peopleSchema from "./schema/people";
import * as scheduleSchema from "./schema/schedule";
import * as settingsSchema from "./schema/settings";
import * as slackSchema from "./schema/slack";
import * as timerSchema from "./schema/timer";
import * as webhooksSchema from "./schema/webhooks";

export const schema = {
	...authSchema,
	...domainSchema,
	...peopleSchema,
	...scheduleSchema,
	...githubSchema,
	...settingsSchema,
	...notificationsSchema,
	...slackSchema,
	...assistantSchema,
	...importSchema,
	...webhooksSchema,
	...timerSchema,
	...instanceSchema,
	...apiTokensSchema,
};

export type Db = PostgresJsDatabase<typeof schema>;

/** Any drizzle handle over this schema, whatever driver backs it. The tests run
 *  on PGLite rather than postgres-js: a different driver type, the same
 *  `PgDatabase` query API over the same tables. */
export type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The handle a read or write may run on: the ambient pool, or an in-flight
 *  transaction. Declared here rather than in `services/context.ts` because
 *  `lib/` needs it too, and a lib importing a service would invert the layering
 *  that keeps `packages/core` reusable. */
export type DbClient = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Connection options, all overridable by environment.
 *
 * `postgres(url)` on its own was the whole configuration, which left this app's
 * one long-lived process with three unstated defaults worth stating:
 *
 *   - **No connect deadline.** `lib/http.ts` exists because `fetch` has no
 *     default timeout and one wedged socket ended the automation sweep; a
 *     connection that hangs on open is the same failure through the other door,
 *     and postgres.js will wait indefinitely by default. Every job here is
 *     idempotent and retried on the next tick, so failing fast is strictly
 *     better than holding the slot.
 *   - **A pool of ten, shared with the schedulers.** Fine for the web host, and
 *     the first thing to raise on a machine that also runs the worker — hence
 *     an env var rather than a constant to go and find.
 *   - **Prepared statements on.** Correct against Postgres directly, and fatal
 *     behind a transaction-mode pooler (PgBouncer, the Supabase/Neon pooled
 *     ports), which recycles the server connection between statements and never
 *     sees the prepare. Set `DATABASE_PREPARE=false` when a pooler is in front;
 *     it is a deployment fact this code cannot detect.
 */
const poolOptions = () => ({
	max: Number(process.env.DATABASE_POOL_MAX ?? 10),
	/** Seconds a connection may sit unused before it is closed. */
	idle_timeout: Number(process.env.DATABASE_IDLE_TIMEOUT ?? 30),
	/** Seconds to wait for a connection to open before giving up. */
	connect_timeout: Number(process.env.DATABASE_CONNECT_TIMEOUT ?? 10),
	prepare: (process.env.DATABASE_PREPARE ?? "true") !== "false",
});

/** Open a handle against a specific database. */
export const createDb = (connectionString: string): Db =>
	drizzle(postgres(connectionString, poolOptions()), { schema });

let ambient: Db | null = null;
let override: Db | null = null;

/** Point every `db` consumer at another handle — a PGLite instance in tests.
 *  Pass null to restore the ambient one. Test-only; nothing in src/ calls it. */
export const setDbForTests = (handle: AnyDb | null): void => {
	// SAFETY: `AnyDb` is `Db` minus the driver's result type, which nothing on
	// this path reads — every consumer goes through the query builders, which are
	// identical across both drivers and typed off the shared schema.
	override = (handle as Db | null) ?? null;
};

const resolve = (): Db => {
	if (override) return override;
	if (!ambient) {
		const url = process.env.DATABASE_URL;
		if (!url) {
			throw new Error(
				"DATABASE_URL is not set. Set it, or call setDbForTests() with a test handle.",
			);
		}
		ambient = createDb(url);
	}
	return ambient;
};

// A lazy handle rather than a module-scope one.
//
// `postgres(process.env.DATABASE_URL!)` used to run at import time, so merely
// importing a service opened a connection pool and a missing DATABASE_URL blew
// up with a non-null-assertion crash before any code ran. That made the whole
// services layer unimportable in a test process, which is a large part of why
// only three test files exist. Resolution now happens on first use, and tests
// can substitute a handle before that first use.
// SAFETY: the target of a Proxy whose every trap forwards to `resolve()`. No
// property is ever read off this object — it exists only to give the Proxy
// something to be, and `Db` is what the traps actually answer with.
export const db = new Proxy({} as Db, {
	// `Reflect.get` IS the correct body of a proxy `get` trap: it is what
	// forwards the receiver, so a getter on the target resolves against the
	// proxy rather than against the target.
	// oxlint-disable-next-line anti-slop/no-reflect-get -- see above
	get: (_target, prop, receiver) => Reflect.get(resolve(), prop, receiver),
	set: (_target, prop, value, receiver) =>
		Reflect.set(resolve(), prop, value, receiver),
	has: (_target, prop) => Reflect.has(resolve(), prop),
	getPrototypeOf: () => Reflect.getPrototypeOf(resolve()),
	ownKeys: () => Reflect.ownKeys(resolve()),
	getOwnPropertyDescriptor: (_target, prop) =>
		Reflect.getOwnPropertyDescriptor(resolve(), prop),
});
