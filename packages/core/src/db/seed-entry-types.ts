import { db } from "./index";
import { timeEntryType } from "./schema/domain";

const SITE_TYPES = [
	{ name: "Work", color: "blue", billableDefault: true },
	{ name: "Break", color: "orange", billableDefault: false },
	{ name: "Meeting", color: "purple", billableDefault: true },
	{ name: "Vacation", color: "green", billableDefault: false },
	{ name: "Sick Leave", color: "red", billableDefault: false },
] as const;

/**
 * Ensure the site-wide default entry types exist. Idempotent
 * (onConflictDoNothing) and org-independent (scope: "site"), so it's safe to
 * call on every boot. Shared by the standalone CLI/entrypoint script (below)
 * and the dev-server startup hook (apps/web/vite.config.ts), so the defaults
 * the app depends on exist in every environment.
 */
export async function ensureSiteEntryTypes() {
	await db
		.insert(timeEntryType)
		.values(
			SITE_TYPES.map((t) => ({
				scope: "site" as const,
				name: t.name,
				color: t.color,
				billableDefault: t.billableDefault,
			})),
		)
		.onConflictDoNothing();
	return SITE_TYPES.length;
}

// Standalone entrypoint: `bun run db:seed-entry-types` and the Docker entrypoint
// run this file directly. Guarded so importing ensureSiteEntryTypes() elsewhere
// doesn't trigger the seed as a side effect.
if (import.meta.main) {
	const count = await ensureSiteEntryTypes();
	console.log(`Seeded ${count} site-wide entry types.`);
	process.exit(0);
}
