// Delete every drizzle snapshot except the newest one.
//
// `drizzle-kit generate` reads only the newest snapshot. Older ones were dead
// weight, and each new migration added about 7,000 lines of them to its PR.
// With one snapshot, a new migration shows as a small rename.
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const metaDir = join(import.meta.dir, "../../drizzle/meta");

const snapshots = (await readdir(metaDir))
	.filter((name) => /^\d+_snapshot\.json$/.test(name))
	.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

for (const name of snapshots.slice(0, -1)) {
	await unlink(join(metaDir, name));
	console.log("deleted", name);
}
