// `db:generate`: run `drizzle-kit generate`, then keep only the newest snapshot.
//
// A script of the form "a && b" does not work here. `bun run db:generate --name x`
// adds `--name x` to the last command, so drizzle-kit never gets it.
// drizzle-kit also asks about renamed columns, so it gets the terminal.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { pruneSnapshots } from "./prune-snapshots";
import { journalSchema, missingSnapshot } from "./snapshot-check";

const metaDir = join(import.meta.dir, "../../drizzle/meta");
const journalFile = join(metaDir, "_journal.json");

// Without the newest snapshot, drizzle-kit diffs against an empty schema
// and writes a migration that creates every table.
if (existsSync(journalFile)) {
	const journal = journalSchema.parse(await Bun.file(journalFile).json());
	const missing = missingSnapshot(journal, readdirSync(metaDir));
	if (missing) {
		const path = `packages/core/drizzle/meta/${missing}`;
		console.error(
			[
				`The snapshot ${path} is missing, so db:generate would write a wrong migration.`,
				"Restore it from git. Find the commit that deleted it:",
				`  git log --diff-filter=D -- ${path}`,
				"Then restore the file from the parent of that commit:",
				`  git checkout <sha>^ -- ${path}`,
				"Do not use `drizzle-kit drop`. It deletes the snapshot.",
			].join("\n"),
		);
		process.exit(1);
	}
}

const proc = Bun.spawn(["drizzle-kit", "generate", ...Bun.argv.slice(2)], {
	stdio: ["inherit", "inherit", "inherit"],
});
const code = await proc.exited;
if (code !== 0) process.exit(code);

await pruneSnapshots();
