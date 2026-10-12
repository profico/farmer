// Check that the newest migration still has its snapshot.
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
