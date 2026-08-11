import { eq, and } from "drizzle-orm";
import { db } from "./index";
import { task } from "./schema/domain";

// The two built-in absence tasks. Site-scoped, unarchivable, and the ONLY tasks
// that may be logged without a project (PRD 3.5). Everything else in the
// taxonomy is org-scoped and admin-managed in Settings.
const SITE_TASKS = [
	{ name: "Vacation", color: "green", isAbsence: true },
	{ name: "Sick Leave", color: "red", isAbsence: true },
] as const;

// Starter taxonomy for a new org. Deliberately small and generic — the point of
// a strictly global task list is a shared vocabulary that keeps cross-project
// reporting comparable, so orgs are expected to curate this, not extend it
// per project (per-project tasks do not exist).
//
// Three of these names are load-bearing beyond the taxonomy: "Meeting" is what
// the Google Calendar sync files imported meetings under, and "Development" and
// "Break" are what the day assembler proposes. Renaming them in Settings simply
// switches those engines off rather than breaking anything.
export const DEFAULT_ORG_TASKS = [
	{ name: "Development", color: "blue" },
	{ name: "Design", color: "violet" },
	{ name: "Meeting", color: "purple" },
	{ name: "Code review", color: "cyan" },
	{ name: "QA & testing", color: "amber" },
	{ name: "Project management", color: "slate" },
	{ name: "Support & maintenance", color: "teal" },
	{ name: "Break", color: "orange" },
] as const;

/**
 * Ensure the site-wide absence tasks exist. Idempotent (onConflictDoNothing) and
 * org-independent, so it's safe to call on every boot. Shared by the standalone
 * CLI entrypoint below and the dev-server startup hook (apps/web/vite.config.ts),
 * so the tasks the app depends on exist in every environment.
 */
export async function ensureSiteTasks() {
	await db
		.insert(task)
		.values(
			SITE_TASKS.map((t) => ({
				scope: "site" as const,
				name: t.name,
				color: t.color,
				isAbsence: t.isAbsence,
			})),
		)
		.onConflictDoNothing();
	return SITE_TASKS.length;
}

/** Seed a new org's starter taxonomy. Idempotent: skips any name already there,
 *  so re-running never duplicates and never resurrects an archived task. */
export async function ensureOrgTasks(organizationId: string) {
	const existing = await db.query.task.findMany({
		where: and(
			eq(task.organizationId, organizationId),
			eq(task.scope, "organization"),
		),
		columns: { name: true },
	});
	const known = new Set(existing.map((t) => t.name));
	const missing = DEFAULT_ORG_TASKS.filter((t) => !known.has(t.name));
	if (missing.length === 0) return 0;

	await db
		.insert(task)
		.values(
			missing.map((t) => ({
				scope: "organization" as const,
				organizationId,
				name: t.name,
				color: t.color,
			})),
		)
		.onConflictDoNothing();
	return missing.length;
}

// Standalone entrypoint: `bun run db:seed-tasks` and the Docker entrypoint run
// this file directly. Guarded so importing the helpers elsewhere doesn't trigger
// the seed as a side effect.
if (import.meta.main) {
	const count = await ensureSiteTasks();
	console.log(`Seeded ${count} site-wide tasks.`);
	process.exit(0);
}
