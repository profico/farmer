import { and, eq } from "drizzle-orm";

import { STANDARD_TASKS } from "../lib/task-taxonomy";
import { db } from "./index";
import { task } from "./schema/domain";

// The site-wide built-ins: one shared row each, owned by no org, uneditable and
// unarchivable (tasksService.update/archive reject site scope). Two kinds live
// here, for two different reasons:
//
//   * Vacation, Sick Leave and Paid Leave are the absence tasks — the only ones that may be
//     logged without a project (PRD 3.5).
//   * Meeting and Break are engine plumbing. The calendar sync needs somewhere
//     to file imported meetings and the day assembler needs something to carve a
//     break out of, so both must exist for every org, always. Site scope is what
//     guarantees that: an admin cannot archive the row out from under the engine.
//     They are not renameable for the same reason site scope makes them
//     reliable — one row is shared by every org — which is precisely why the
//     *taxonomy* tasks below stayed org-scoped.
const SITE_TASKS = [
	{
		name: "Vacation",
		color: "green",
		group: "time_off" as const,
		isAbsence: true,
		systemKey: "vacation",
	},
	{
		name: "Sick Leave",
		color: "red",
		group: "time_off" as const,
		isAbsence: true,
		systemKey: "sick",
	},
	{
		name: "Paid Leave",
		color: "teal",
		group: "time_off" as const,
		isAbsence: true,
		systemKey: "paid_leave",
	},
	{
		name: "Meeting",
		color: "purple",
		group: "general" as const,
		isAbsence: false,
		systemKey: "meeting",
	},
	{
		name: "Break",
		color: "orange",
		group: "general" as const,
		isAbsence: false,
		systemKey: "break",
	},
] as const;

// Starter taxonomy for a new org: the standard list in `lib/task-taxonomy.ts`,
// which is also what the Harvest import folds its task names into. Orgs are
// expected to curate this, not extend it per project (per-project tasks do
// not exist). All renameable, including "Development" — the day assembler
// resolves it by `systemKey`, so calling it "Engineering" changes the label
// and nothing else.
export const DEFAULT_ORG_TASKS = STANDARD_TASKS.map((t) => ({
	name: t.name,
	color: t.color,
	group: t.group,
	systemKey: "systemKey" in t ? t.systemKey : null,
}));

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
				group: t.group,
				isAbsence: t.isAbsence,
				systemKey: t.systemKey,
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
		columns: { name: true, systemKey: true },
	});
	const knownNames = new Set(existing.map((t) => t.name));
	// Skipping on the system key as well as the name matters now that this runs on
	// every boot: an org that renamed "Development" to "Engineering" still holds
	// the `development` key, and matching on name alone would seed a second,
	// competing "Development" underneath them on the next pass.
	const knownKeys = new Set(
		existing.flatMap((t) => (t.systemKey ? [t.systemKey] : [])),
	);
	// Archived rows count as known, deliberately: archiving a starter task means
	// "we don't use this", and re-seeding would resurrect it every boot.
	const missing = DEFAULT_ORG_TASKS.filter(
		(t) =>
			!knownNames.has(t.name) && !(t.systemKey && knownKeys.has(t.systemKey)),
	);
	if (missing.length === 0) return 0;

	await db
		.insert(task)
		.values(
			missing.map((t) => ({
				scope: "organization" as const,
				organizationId,
				name: t.name,
				color: t.color,
				group: t.group,
				systemKey: t.systemKey,
			})),
		)
		.onConflictDoNothing();
	return missing.length;
}

/**
 * Bring every existing org up to the current starter taxonomy. Idempotent per
 * org (see above), so this is safe to run on every deploy — which is the point:
 * orgs created before task seeding was wired into signup have no tasks at all,
 * and this is what heals them without a bespoke one-off migration.
 */
export async function ensureOrgTasksForAllOrgs() {
	const orgs = await db.query.organization.findMany({ columns: { id: true } });
	let seeded = 0;
	for (const o of orgs) seeded += await ensureOrgTasks(o.id);
	return { organizations: orgs.length, seeded };
}

// Standalone entrypoint: `bun run db:seed-tasks` and the Docker entrypoint run
// this file directly. Guarded so importing the helpers elsewhere doesn't trigger
// the seed as a side effect.
if (import.meta.main) {
	const count = await ensureSiteTasks();
	console.log(`Seeded ${count} site-wide tasks.`);
	const { organizations, seeded } = await ensureOrgTasksForAllOrgs();
	console.log(`Seeded ${seeded} org tasks across ${organizations} orgs.`);
	process.exit(0);
}
