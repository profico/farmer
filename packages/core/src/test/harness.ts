// An ephemeral, in-process Postgres for tests.
//
// PGLite is real Postgres compiled to WASM, so the migrations, the constraints
// and the SQL the services actually emit all run for real — the tenancy tests
// exist precisely because the bug they cover was about a WHERE clause reaching
// the database, and mocking drizzle would not have caught it.
//
// What this replaces: the previous DB-backed test wrote into whatever
// DATABASE_URL pointed at (a developer's dev database), inserted its fixtures
// at module top level outside any hook, and dodged a unique index by suffixing
// names with a UUID. Each harness here is a fresh database that exists only for
// the file that asked for it.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { type AnyDb, schema, setDbForTests } from "../db";

const migrationsFolder = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../drizzle",
);

export type TestDb = {
	db: AnyDb;
	/** Restore the ambient handle. */
	close: () => Promise<void>;
};

/**
 * One PGLite ENGINE for the whole run, re-schema'd per file.
 *
 * Each file still gets what it asks for — an empty, freshly migrated database
 * that nothing else has written to — but it is a new schema inside one Postgres
 * rather than a new Postgres.
 *
 * That distinction is the difference between a green CI and a red one. `bun
 * test` runs every file in ONE process, and a PGLite instance is a few hundred
 * megabytes of WASM linear memory: a `WebAssembly.Memory` never shrinks, and
 * closing the client drops the reference without giving the pages back — a
 * forced `Bun.gc(true)` between files does not move the number either. So the
 * suite's footprint was the SUM of every database it had ever opened: ~450MB
 * per file, ~11GB across thirty, which a laptop absorbs and a 7GB runner
 * answers with SIGKILL. Sharing the engine makes the peak the cost of one
 * database plus the largest file's data.
 *
 * It relies on test files running sequentially in one process, which is what
 * `bun test` does. Should that ever change, this needs to become one engine per
 * worker rather than one per run — the reset below would otherwise pull the
 * schema out from under a file running beside it.
 */
let engine: PGlite | null = null;

/** Spin up a migrated, empty database and point `db` at it.
 *
 *  Call in `beforeAll`, and `close()` in `afterAll`. Because every consumer
 *  reads through the lazy `db` proxy, services need no change to run here. */
export const createTestDb = async (): Promise<TestDb> => {
	if (!engine) engine = new PGlite();
	const client = engine;

	// A fresh database, spelled as a schema reset. `drizzle` holds the migration
	// ledger, so it goes too — otherwise the migrator would find every migration
	// already applied and hand the next file an empty database with no tables.
	await client.exec(`
		DROP SCHEMA IF EXISTS drizzle CASCADE;
		DROP SCHEMA IF EXISTS public CASCADE;
		CREATE SCHEMA public;
	`);

	const handle = drizzle(client, { schema });

	await migrate(handle, { migrationsFolder });

	setDbForTests(handle);

	return {
		db: handle,
		// The engine deliberately outlives this: the next file resets it, and
		// `closeTestEngine` below shuts it down once the whole run is over.
		close: async () => {
			setDbForTests(null);
		},
	};
};

/**
 * Shut the shared engine down. Called once for the whole run from
 * `src/test/preload.ts`, never from a test file.
 *
 * An engine left open is a live handle at exit, and `bun test` marks the run
 * failed (exit 99) on that alone — a red CI for a suite where nothing failed.
 */
export const closeTestEngine = async (): Promise<void> => {
	if (!engine) return;
	const client = engine;
	engine = null;
	await client.close();
};

/**
 * Index into a fixture array, failing the test rather than asserting.
 *
 * `noUncheckedIndexedAccess` types every element `T | undefined`, and the usual
 * answer in a test is `rows[0] as Row` — which turns "the fixture didn't build
 * what I thought" into a null-dereference twenty lines later, on a line that
 * has nothing to do with the mistake. This names the row that is missing.
 */
export const at = <T>(rows: readonly T[], index: number): T => {
	const row = rows[index];
	if (row === undefined) {
		throw new Error(`fixture has no row at index ${index} (of ${rows.length})`);
	}
	return row;
};

/**
 * Assert a nullable fixture value is actually there, and hand back the narrowed
 * value — the companion to `at` for `T | null` rather than `T | undefined`.
 *
 * `expect(x).not.toBeNull()` proves it at runtime but narrows nothing, so the
 * line after it still needs `x as T`. This does both, and names what was
 * missing when it wasn't.
 */
export const present = <T>(value: T | null | undefined, what: string): T => {
	if (value === null || value === undefined) {
		throw new Error(`expected ${what} to be present`);
	}
	return value;
};
