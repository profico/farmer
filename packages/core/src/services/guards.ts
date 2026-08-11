import { and, eq, or } from "drizzle-orm";
import { db } from "../db";
import { project, projectTask, task } from "../db/schema/domain";
import type { Ctx } from "./types";

// Tenancy and taxonomy guards shared by every write path that accepts a
// caller-supplied project or task id. They live in their own module rather than
// on a service because both time-entries and recurring-block-rules need them,
// and importing one service from the other would make the pair circular.

/**
 * A task every project offers without anyone picking it: site-scoped and not an
 * absence. Today that is Meeting and Break — platform plumbing the engines write
 * to, which no single org curates and none can opt out of.
 *
 * Deliberately keyed on `scope`/`isAbsence` rather than on the `systemKey` list,
 * so any future site built-in is universal by construction. Org-scoped tasks are
 * never universal however common they are: "Development" is vocabulary one org
 * renames, and a project that doesn't do development shouldn't offer it.
 *
 * The SQL form of this predicate is inlined in `tasksService.listForProject`;
 * keep the two in step.
 */
export const isUniversalTask = (t: { scope: string; isAbsence: boolean }) =>
	t.scope === "site" && !t.isAbsence;

/**
 * Cross-tenant guard: a projectId supplied by the client must belong to the
 * caller's org, or a user in one org could reach another org's project by
 * guessing its id. Always enforced in the WHERE clause — never by fetching the
 * row and comparing organizationId in JS afterwards.
 */
export const assertProjectInOrg = async (ctx: Ctx, projectId: string) => {
	const row = await db.query.project.findFirst({
		where: and(
			eq(project.id, projectId),
			eq(project.organizationId, ctx.organizationId),
		),
		columns: { id: true },
	});
	if (!row) throw new Error("Project not found");
};

/**
 * The taxonomy gate on every entry write. Four shapes are legal:
 *
 *   * a WORKED entry — a non-absence task the project has cherry-picked, plus
 *     that project;
 *   * a UNIVERSAL entry — a site-scoped non-absence built-in (Meeting, Break)
 *     plus any project in the org. These are not cherry-picked: see below;
 *   * an ABSENCE entry — one of the two built-in absence tasks and no project at
 *     all, because Vacation and Sick Leave carry no client and no project;
 *   * an UNFILED entry — a non-absence task and no project yet. A draft: real
 *     time on the day, not yet attributed to a project.
 *
 * Unfiled used to be rejected here ("Pick a project for this task") while three
 * engines wrote it straight to the database anyway, bypassing this guard: the
 * calendar sync files imported meetings with no project, and the commit fill
 * block and day assembler do the same. The result was a row the app could
 * produce but neither create by hand nor edit — opening a synced meeting and
 * saving it threw, because `update` runs this guard too. Admitting the shape is
 * what makes those entries editable; `timeEntriesService.countUnfiled` and the
 * close guard are what stop them from being forgotten.
 *
 * Anything else (an absence task pinned to a project, a task some other project
 * picked, another org's task) is still rejected. This is the service-layer half
 * of the invariant; the database can't express it because the checks need joins.
 */
export const assertTaskAvailable = async (
	ctx: Ctx,
	taskId: string,
	projectId: string | undefined,
) => {
	// Tenancy lives in the WHERE: a site-scoped task is everyone's, an
	// org-scoped one is only its own org's. Never fetched-then-compared.
	const row = await db.query.task.findFirst({
		where: and(
			eq(task.id, taskId),
			or(
				eq(task.scope, "site"),
				eq(task.organizationId, ctx.organizationId),
			),
		),
		columns: { id: true, scope: true, isAbsence: true, archivedAt: true },
	});
	if (!row || row.archivedAt) throw new Error("Task not available");

	if (row.isAbsence) {
		if (projectId) {
			throw new Error("Vacation and Sick Leave are logged without a project");
		}
		return;
	}

	// Unfiled: legal, and left for the user to complete. Nothing to check against
	// — there is no project whose picked subset the task would have to be in.
	if (!projectId) return;

	// Universal built-ins bypass the cherry-pick. A site-scoped non-absence task
	// is engine plumbing every org needs — you meet about a project and you take
	// breaks on one — so making an admin add Meeting to each project separately is
	// busywork whose only real effect is failure: forget it on one project and the
	// calendar sync's own entries can't be filed there, which is the bug this
	// whole built-in mechanism exists to fix. Absence tasks are the other
	// universal shape, handled above; they differ in taking no project at all.
	if (isUniversalTask(row)) return;

	const picked = await db.query.projectTask.findFirst({
		where: and(
			eq(projectTask.organizationId, ctx.organizationId),
			eq(projectTask.projectId, projectId),
			eq(projectTask.taskId, taskId),
		),
		columns: { id: true },
	});
	if (!picked) throw new Error("That task is not available on this project");
};
