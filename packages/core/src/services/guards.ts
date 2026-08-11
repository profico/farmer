import { and, eq, or } from "drizzle-orm";
import { db } from "../db";
import { project, projectTask, task } from "../db/schema/domain";
import type { Ctx } from "./types";

// Tenancy and taxonomy guards shared by every write path that accepts a
// caller-supplied project or task id. They live in their own module rather than
// on a service because both time-entries and recurring-block-rules need them,
// and importing one service from the other would make the pair circular.

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
 * The taxonomy gate on every entry write. Two mutually exclusive shapes are
 * legal:
 *
 *   * a WORKED entry — a non-absence task the project has cherry-picked, plus
 *     that project;
 *   * an ABSENCE entry — one of the two built-in absence tasks and no project at
 *     all, because Vacation and Sick Leave carry no client and no project.
 *
 * Anything else (an absence task pinned to a project, a project task logged
 * without its project, a task some other project picked, another org's task) is
 * rejected. This is the service-layer half of the invariant; the database can't
 * express it because the absence check needs a join.
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
		columns: { id: true, isAbsence: true, archivedAt: true },
	});
	if (!row || row.archivedAt) throw new Error("Task not available");

	if (row.isAbsence) {
		if (projectId) {
			throw new Error("Vacation and Sick Leave are logged without a project");
		}
		return;
	}

	if (!projectId) throw new Error("Pick a project for this task");

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
