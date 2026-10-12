// The drizzle snapshot rule: keep only the newest snapshot.
//
// `drizzle-kit generate` diffs only against the newest snapshot, so older ones
// only make each migration's PR bigger. The one snapshot must belong to the last
// migration in the journal. Otherwise the next `generate` diffs the schema
// against a stale base and writes a wrong migration.

import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { journalSchema, snapshotName } from "./snapshot-check";

const metaDir = join(import.meta.dir, "../../drizzle/meta");
const fix =
	"Run `bun run db:generate` (it prunes), or `bun run src/db/prune-snapshots.ts`.";

test("drizzle/meta holds one snapshot, for the last migration", async () => {
	const snapshots = readdirSync(metaDir).filter((name) =>
		name.endsWith("_snapshot.json"),
	);
	expect(
		snapshots.length,
		"Found 0 snapshots. Restore the newest one from git. Do not run `bun run db:generate`: it would write a migration for the full schema.",
	).toBeGreaterThan(0);
	expect(
		snapshots,
		`Expected exactly one snapshot, found ${snapshots.length}. ${fix}`,
	).toHaveLength(1);

	const journal = journalSchema.parse(
		await Bun.file(join(metaDir, "_journal.json")).json(),
	);
	const last = journal.entries.at(-1);
	const expected = snapshotName(last?.idx ?? -1);
	expect(
		snapshots[0],
		`The snapshot must be ${expected}, the last journal entry. ${fix}`,
	).toBe(expected);
});
