import { and, eq, or } from "drizzle-orm";

import { member } from "../db/schema/auth";
import { project, task } from "../db/schema/domain";
import { descriptionRequiredFor } from "../lib/task-rules";
import { ctxDb } from "./db-ctx";
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
	// `ctxDb`, not the ambient handle: reachable from inside a transaction via
	// `setWeekCell` -> `create(txCtx, …)`. See ./db-ctx.
	const row = await ctxDb(ctx).query.project.findFirst({
		where: and(
			eq(project.id, projectId),
			eq(project.organizationId, ctx.organizationId),
		),
		columns: { id: true },
	});

	if (!row) throw new Error("Project not found");
};

/**
 * The same guard for a caller-supplied userId: the person being written ABOUT
 * must be a member of the caller's organization.
 *
 * Distinct from every authorization check, and needed alongside them rather
 * than instead of them. The capability checks answer "may you act on this
 * person" — `canOverrideAbsenceFor` looks at the projects you share, and
 * `requireAdmin` at your tier. Neither asks whether the id names anybody here:
 * an admin satisfies `canOverrideAbsenceFor` unconditionally (it short-circuits
 * on `isAdmin`) and a non-member's shared-project list is empty either way, so
 * a mistyped or copied id wrote a real row — an absence entry, a start date, an
 * archive flag — keyed to somebody who is not in the workspace. Tenancy held
 * (the rows carry `ctx.organizationId`), so it was never a leak; it was rows
 * that no list would ever show and no screen could ever clean up.
 */
export const assertUserInOrg = async (ctx: Ctx, userId: string) => {
	// `ctxDb`, like the two guards below it: every guard in this file is
	// reachable from inside an open transaction, and an ambient read from there
	// sees pre-transaction state (and deadlocks a single-connection handle).
	const row = await ctxDb(ctx).query.member.findFirst({
		where: and(
			eq(member.organizationId, ctx.organizationId),
			eq(member.userId, userId),
		),
		columns: { id: true },
	});

	if (!row) throw new Error("That person is not a member of this organization");
};

/**
 * The taxonomy gate on every entry write. Four shapes are legal:
 *
 *   * a WORKED entry — a non-absence task the project has cherry-picked, plus
 *     that project;
 *   * a UNIVERSAL entry — a site-scoped non-absence built-in (Meeting, Break)
 *     plus any project in the org. These are not cherry-picked: see below;
 *   * an ABSENCE entry — one of the built-in absence tasks and no project at
 *     all, because absence carries no client and no project;
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
 * Anything else (an absence task pinned to a project, another org's task, an
 * archived task) is still rejected. Resolves to the task's flags, so a caller
 * that also needs `isAbsence` or `systemKey` does not fetch the row twice. This is the service-layer half
 * of the invariant; the database can't express it because the checks need joins.
 */
export const assertTaskAvailable = async (
	ctx: Ctx,
	taskId: string,
	projectId: string | undefined,
) => {
	// Tenancy lives in the WHERE: a site-scoped task is everyone's, an
	// org-scoped one is only its own org's. Never fetched-then-compared.
	const row = await ctxDb(ctx).query.task.findFirst({
		where: and(
			eq(task.id, taskId),
			or(eq(task.scope, "site"), eq(task.organizationId, ctx.organizationId)),
		),
		columns: {
			id: true,
			scope: true,
			isAbsence: true,
			systemKey: true,
			archivedAt: true,
		},
	});

	if (!row || row.archivedAt) throw new Error("Task not available");

	if (row.isAbsence) {
		if (projectId) {
			throw new Error("Absence is logged without a project");
		}

		return row;
	}

	// Unfiled — no project yet — is legal and left for the user to complete.
	// With a project, any live non-absence task of the org (or a site built-in)
	// may be used: the taxonomy is one global list, and there is no per-project
	// subset to check against any more.
	return row;
};

/**
 * The mandatory-description rule, enforced where the task is known.
 *
 * Worked time must say what was done; time off and a Break need not
 * (`descriptionRequiredFor`). It used to be a refinement on the entry input
 * that keyed on "was a project supplied" — the only proxy the schema could see —
 * which broke both ways once every task sat on every project: a Break on a
 * project demanded a note, and a project-less Meeting got away without one.
 *
 * A fill block is exempt: its note is derived by the engines after the fact.
 * The week grid is exempt by its caller (`setWeekCell`), because a spreadsheet
 * cell cannot answer the question; the row's note button asks it later.
 */
export const assertDescribed = (
	taskRow: { isAbsence: boolean; systemKey: string | null },
	description: string | undefined,
	{ fillsDay = false }: { fillsDay?: boolean } = {},
) => {
	if (fillsDay || !descriptionRequiredFor(taskRow)) return;

	if (!description?.trim()) throw new Error("Describe what you worked on");
};
