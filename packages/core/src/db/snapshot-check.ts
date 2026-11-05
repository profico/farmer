// Check that the newest migration still has its snapshot, and only it.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

export const journalSchema = z.object({
	entries: z.array(z.object({ idx: z.number().int() })),
});

export function snapshotName(idx: number) {
	return `${String(idx).padStart(4, "0")}_snapshot.json`;
}

// Return the snapshot file name that is missing, or null when all is well.
// An empty journal is the first run, so it has nothing to check.
export function missingSnapshot(
	journal: z.infer<typeof journalSchema>,
	files: readonly string[],
) {
	const last = journal.entries.at(-1);
	if (!last) return null;
	const name = snapshotName(last.idx);
	return files.includes(name) ? null : name;
}

// drizzle-kit drops the names that start with `_`, sorts the rest and reads
// the last one as the snapshot. Any file counts, also `0077_snapshot.json.bak`.
// Return a file that sorts after the expected one, or null.
export function newerSnapshot(
	journal: z.infer<typeof journalSchema>,
	files: readonly string[],
) {
	const last = journal.entries.at(-1);
	if (!last) return null;
	const expected = snapshotName(last.idx);
	const newest = files
		.filter((name) => !name.startsWith("_"))
		.sort()
		.at(-1);
	return newest && newest > expected ? newest : null;
}

const restore = (file: string) =>
	[
		"Restore it from git. Try the index first, then HEAD:",
		`  git checkout -- ':/packages/core/drizzle/meta/${file}'`,
		`  git checkout HEAD -- ':/packages/core/drizzle/meta/${file}'`,
		"If a commit deleted it, find that commit and restore from its parent:",
		`  git log --diff-filter=D -- ':/packages/core/drizzle/meta/${file}'`,
		`  git checkout <sha>^ -- ':/packages/core/drizzle/meta/${file}'`,
		"Do not use `drizzle-kit drop`. It deletes the snapshot.",
	].join("\n");

// Return a message that describes the problem with the meta folder, or null.
export async function metaProblem(metaDir: string) {
	const journalFile = join(metaDir, "_journal.json");
	if (!existsSync(journalFile)) return null;
	const journal = journalSchema.parse(await Bun.file(journalFile).json());
	const files = readdirSync(metaDir);

	const missing = missingSnapshot(journal, files);
	if (missing) {
		return [
			`The snapshot ${missing} is missing, so db:generate would write a wrong migration.`,
			restore(missing),
		].join("\n");
	}
	const newer = newerSnapshot(journal, files);
	if (newer) {
		return [
			`The snapshot ${newer} is newer than the last journal entry, so drizzle-kit would use it as the base.`,
			`Delete packages/core/drizzle/meta/${newer} if it is a leftover of an undo.`,
		].join("\n");
	}
	return null;
}
