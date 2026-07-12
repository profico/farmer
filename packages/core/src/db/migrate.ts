/**
 * Applies pending Drizzle migrations, then exits.
 *
 * Uses drizzle-orm's own migrator (`drizzle-orm/postgres-js/migrator`) rather
 * than `drizzle-kit migrate` so it runs against the production dependency set:
 * drizzle-kit is a devDependency and isn't present in the trimmed runtime
 * image, but `drizzle-orm` + `postgres` are. It only needs the shipped
 * `drizzle/` SQL folder (+ its `meta/_journal.json`), which the Docker runtime
 * stage copies alongside packages/core.
 *
 * Run at container startup before the server boots (see Dockerfile /
 * docker-entrypoint), or locally with `bun run db:deploy` from packages/core.
 *
 * Concurrency: on a multi-replica boot every replica runs this at once.
 * Postgres session-level advisory locks (`pg_advisory_lock`) serialize that —
 * the first replica to connect acquires the lock and migrates, the rest block
 * on the *same* connection until it's released (`pg_advisory_unlock`) rather
 * than racing drizzle-kit's own migration-table bookkeeping. The lock key is
 * an arbitrary fixed int8 constant scoped to this app (chosen from the app
 * name so it doesn't collide with other advisory-lock users on the same DB).
 * The lock is held on the same single connection used to run the migration
 * (advisory locks are connection-scoped), so `client.end()` also releases it
 * if the process dies before the explicit unlock.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Arbitrary fixed key for this app's migration lock (fits in a signed int8).
// Derived once from "farmer:db:migrate" — kept as a literal so it never
// silently changes across environments.
const MIGRATION_LOCK_KEY = 7_924_611_305_198_542;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error("[migrate] DATABASE_URL is not set");
	process.exit(1);
}

// A dedicated single-connection client — migrations are one-shot, must not
// share the app's pool, and the advisory lock below is connection-scoped so
// it must be acquired/held/released on this exact connection.
const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

// Default: the `drizzle/` folder two levels up from this source file
// (packages/core/drizzle). Override with DRIZZLE_MIGRATIONS_DIR when this
// module is bundled/relocated (e.g. the Docker runtime ships migrate.js and
// the drizzle/ SQL folder at fixed, unrelated paths).
const migrationsFolder =
	process.env.DRIZZLE_MIGRATIONS_DIR ??
	path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");

try {
	console.log("[migrate] waiting for advisory lock...");
	await client`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
	console.log("[migrate] lock acquired");

	try {
		console.log(`[migrate] applying migrations from ${migrationsFolder}`);
		await migrate(db, { migrationsFolder });
		console.log("[migrate] done");
	} finally {
		await client`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
		console.log("[migrate] lock released");
	}
} catch (error) {
	console.error(`[migrate] failed: ${String(error)}`);
	await client.end();
	process.exit(1);
}

await client.end();
