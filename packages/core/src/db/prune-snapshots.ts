// Delete every drizzle snapshot except the newest one.
//
// `drizzle-kit generate` diffs only against the newest snapshot. Older ones
// add no value to it, and each new migration added about 7,000 lines of
// them to its PR. `drizzle-kit up` (the v1 upgrade) needs every snapshot.
// Restore only the snapshots, never `_journal.json`:
// git checkout 0b6f8713 -- ':(glob)packages/core/drizzle/meta/*_snapshot.json'
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const metaDir = join(import.meta.dir, "../../drizzle/meta");

export async function pruneSnapshots() {
	const snapshots = (await readdir(metaDir))
		.filter((name) => /^\d+_snapshot\.json$/.test(name))
		.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

	for (const name of snapshots.slice(0, -1)) {
		await unlink(join(metaDir, name));
		console.log("deleted", name);
	}
}

if (import.meta.main) await pruneSnapshots();
