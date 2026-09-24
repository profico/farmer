import { INSTANCE_SETTINGS, isSecretKind } from "../lib/instance-settings";
import { sealSecret } from "../lib/secret-box";
import { db } from "./index";
import { instanceSetting } from "./schema/instance";

// Copy the instance settings that are set in this process's environment into
// the `instance_setting` table: `bun run settings:import-env` from
// packages/core, with the deployment's environment loaded.
//
// It exists for a deployment that holds its whole configuration in the
// environment and wants to move to the Infrastructure pages. The environment
// wins (ADR 0004), so the order is: run this, check the pages, then remove the
// variables. A variable removed first leaves its feature unconfigured until
// somebody fills the field in, and a secret cannot be read back from anywhere
// to fill it with. See `docs/plans/instance-settings-migration.md`.
//
// A row that exists is kept, so a second run never overwrites a value somebody
// changed on the page. `--overwrite` replaces it. Names are printed, values
// never are.

const overwrite = process.argv.includes("--overwrite");

const copied: string[] = [];
const kept: string[] = [];

for (const definition of INSTANCE_SETTINGS) {
	const value = process.env[definition.name]?.trim();
	if (!value) continue;
	const stored = isSecretKind(definition) ? sealSecret(value) : value;
	const now = new Date();
	const insert = db
		.insert(instanceSetting)
		.values({ name: definition.name, value: stored, updatedAt: now });
	const rows = await (
		overwrite
			? insert.onConflictDoUpdate({
					target: instanceSetting.name,
					set: { value: stored, updatedAt: now, updatedBy: null },
				})
			: insert.onConflictDoNothing()
	).returning({ name: instanceSetting.name });
	(rows.length > 0 ? copied : kept).push(definition.name);
}

console.log(
	copied.length > 0
		? `Copied ${String(copied.length)}: ${copied.join(", ")}`
		: "Copied nothing.",
);
if (kept.length > 0) {
	console.log(
		`Kept the stored value (use --overwrite to replace): ${kept.join(", ")}`,
	);
}
process.exit(0);
