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
import { type Db, schema, setDbForTests } from "../db";

const migrationsFolder = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../drizzle",
);

export type TestDb = {
	db: Db;
	/** Restore the ambient handle and free the instance. */
	close: () => Promise<void>;
};

/** Spin up a migrated, empty database and point `db` at it.
 *
 *  Call in `beforeAll`, and `close()` in `afterAll`. Because every consumer
 *  reads through the lazy `db` proxy, services need no change to run here. */
export const createTestDb = async (): Promise<TestDb> => {
	const client = new PGlite();
	const handle = drizzle(client, { schema });

	await migrate(handle, { migrationsFolder });

	setDbForTests(handle);

	return {
		db: handle as unknown as Db,
		close: async () => {
			setDbForTests(null);
			await client.close();
		},
	};
};
