import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as authSchema from "./schema/auth";
import * as closeSchema from "./schema/close";
import * as domainSchema from "./schema/domain";
import * as githubSchema from "./schema/github";
import * as notificationsSchema from "./schema/notifications";
import * as peopleSchema from "./schema/people";
import * as scheduleSchema from "./schema/schedule";
import * as settingsSchema from "./schema/settings";
import * as slackSchema from "./schema/slack";

export const schema = {
	...authSchema,
	...domainSchema,
	...peopleSchema,
	...scheduleSchema,
	...closeSchema,
	...githubSchema,
	...settingsSchema,
	...notificationsSchema,
	...slackSchema,
};

export type Db = PostgresJsDatabase<typeof schema>;

/** Open a handle against a specific database. */
export const createDb = (connectionString: string): Db =>
	drizzle(postgres(connectionString), { schema });

let ambient: Db | null = null;
let override: Db | null = null;

/** Point every `db` consumer at another handle — a PGLite instance in tests.
 *  Pass null to restore the ambient one. Test-only; nothing in src/ calls it. */
export const setDbForTests = (handle: unknown): void => {
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
export const db = new Proxy({} as Db, {
	get: (_target, prop, receiver) => Reflect.get(resolve(), prop, receiver),
	set: (_target, prop, value, receiver) =>
		Reflect.set(resolve(), prop, value, receiver),
	has: (_target, prop) => Reflect.has(resolve(), prop),
	getPrototypeOf: () => Reflect.getPrototypeOf(resolve()),
	ownKeys: () => Reflect.ownKeys(resolve()),
	getOwnPropertyDescriptor: (_target, prop) =>
		Reflect.getOwnPropertyDescriptor(resolve(), prop),
});
