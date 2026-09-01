import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { project, task } from "../db/schema/domain";
import { filingRule } from "../db/schema/settings";
import type { DeleteFilingRuleInput } from "../schema/filing-rules";
import { ctxAccess } from "./context";
import { assertProjectInOrg, assertTaskAvailable } from "./guards";
import type { Ctx } from "./types";

// Standing answers to "which project does this meeting belong to".
//
// The engines file nothing: a synced meeting lands project-less on purpose, and
// the File-your-time dialog is where a person attributes it. That is the right
// default and the wrong amount of work for the recurring case — a weekly
// stand-up is fifty rows a year of one answer, which is the complaint the
// grouping in that dialog only half fixes.
//
// A rule is the other half: it is applied by `syncMeetingsForRange` at write
// time, so the occurrence arrives already filed and never shows up as unfiled
// at all.

/** The match key. Trim + lower-case, and nothing else: two people typing the
 *  same meeting name with different capitalisation mean the same meeting, and
 *  anything cleverer (stripping punctuation, collapsing numbers) starts
 *  matching things the person never agreed to. */
export const filingRuleKey = (title: string) => title.trim().toLowerCase();

export const filingRulesService = {
	/** The caller's own rules, with the names needed to render them. */
	list: async (ctx: Ctx) =>
		db
			.select({
				id: filingRule.id,
				title: filingRule.title,
				taskId: filingRule.taskId,
				taskName: task.name,
				projectId: filingRule.projectId,
				projectName: project.name,
				projectCode: project.code,
				createdAt: filingRule.createdAt,
			})
			.from(filingRule)
			.innerJoin(task, eq(filingRule.taskId, task.id))
			.innerJoin(project, eq(filingRule.projectId, project.id))
			.where(
				and(
					eq(filingRule.organizationId, ctx.organizationId),
					eq(filingRule.userId, ctx.userId),
				),
			)
			.orderBy(asc(filingRule.title)),

	/**
	 * Record rules from entries that were just filed.
	 *
	 * Derived from the entries rather than sent as its own payload: the rows
	 * already carry the task and the description, which are exactly the two
	 * halves of the key, so the client cannot send a rule for something it did
	 * not actually file. It also means the rule and the filing are one write from
	 * the user's point of view — they ticked "remember this" on the decision they
	 * were already making.
	 *
	 * Best-effort and never throws: the filing itself already succeeded, and
	 * failing the whole call because a preference could not be saved would report
	 * an error for work that was done.
	 */
	rememberFrom: async (
		ctx: Ctx,
		projectId: string,
		entries: { taskId: string; description: string }[],
	) => {
		// One row per distinct (task, title). A month of stand-ups is one rule.
		const byKey = new Map<
			string,
			{ taskId: string; titleKey: string; title: string }
		>();
		for (const entry of entries) {
			const title = entry.description.trim();
			// An empty description is not a rule. The dialog falls back to the task
			// name for display, so a rule keyed on "" would read as "always file
			// Meeting to X" and then claim every untitled meeting the sync imports —
			// which is the one-default-project behaviour this feature exists instead
			// of.
			if (!title) continue;
			const titleKey = filingRuleKey(title);
			byKey.set(`${entry.taskId}|${titleKey}`, {
				taskId: entry.taskId,
				titleKey,
				title,
			});
		}
		if (byKey.size === 0) return 0;

		const rows = [...byKey.values()].map((rule) => ({
			organizationId: ctx.organizationId,
			userId: ctx.userId,
			projectId,
			...rule,
		}));

		// onConflictDoUpdate, not DoNothing: re-filing a meeting somewhere else and
		// asking to remember it is a change of mind, and the newer answer wins.
		await db
			.insert(filingRule)
			.values(rows)
			.onConflictDoUpdate({
				target: [
					filingRule.organizationId,
					filingRule.userId,
					filingRule.taskId,
					filingRule.titleKey,
				],
				set: {
					projectId,
					// Refreshes the display casing to whatever the person just saw.
					title: sql`excluded.title`,
					updatedAt: new Date(),
				},
			});
		return rows.length;
	},

	remove: async (ctx: Ctx, input: DeleteFilingRuleInput) => {
		// userId in the WHERE, not checked after the read: a rule is personal, and
		// an admin has no business deleting somebody else's by guessing an id.
		const [deleted] = await db
			.delete(filingRule)
			.where(
				and(
					eq(filingRule.id, input.id),
					eq(filingRule.organizationId, ctx.organizationId),
					eq(filingRule.userId, ctx.userId),
				),
			)
			.returning({ id: filingRule.id });
		if (!deleted) throw new Error("Filing rule not found");
		return deleted;
	},

	/**
	 * The engine-facing half: `titleKey -> projectId` for one task, already
	 * filtered to projects the person may still write to.
	 *
	 * Re-checked rather than trusted, because a rule outlives the assignment that
	 * made it valid — being taken off a project does not delete the rules naming
	 * it, and a rule that quietly kept filing hours onto a project somebody is no
	 * longer on is the failure mode worth spending two queries to avoid. A rule
	 * that no longer applies is dropped silently: the entry lands unfiled, which
	 * is the same place it would have landed with no rule at all, and the person
	 * sees it in the dialog rather than getting a sync error about a preference.
	 */
	resolveForTask: async (
		ctx: Ctx,
		taskId: string,
	): Promise<Map<string, string>> => {
		const rules = await db
			.select({
				titleKey: filingRule.titleKey,
				projectId: filingRule.projectId,
			})
			.from(filingRule)
			.where(
				and(
					eq(filingRule.organizationId, ctx.organizationId),
					eq(filingRule.userId, ctx.userId),
					eq(filingRule.taskId, taskId),
				),
			);
		if (rules.length === 0) return new Map();

		const access = await ctxAccess(ctx);
		const candidates = [...new Set(rules.map((r) => r.projectId))];

		// Archived projects are dormant — the picker in the dialog excludes them,
		// and a rule should not keep writing to one behind the person's back.
		const live = await db
			.select({ id: project.id })
			.from(project)
			.where(
				and(
					eq(project.organizationId, ctx.organizationId),
					eq(project.status, "active"),
					inArray(project.id, candidates),
				),
			);
		const liveIds = new Set(live.map((p) => p.id));

		const usable = new Set<string>();
		for (const projectId of candidates) {
			if (!liveIds.has(projectId)) continue;
			if (!access.canTrackOn(projectId)) continue;
			try {
				// Meeting is a universal built-in so this passes today, but the check
				// is what keeps the rule honest if a rule is ever recorded for an
				// org-scoped task the project has since dropped.
				await assertProjectInOrg(ctx, projectId);
				await assertTaskAvailable(ctx, taskId, projectId);
			} catch {
				continue;
			}
			usable.add(projectId);
		}

		return new Map(
			rules
				.filter((r) => usable.has(r.projectId))
				.map((r) => [r.titleKey, r.projectId]),
		);
	},
};
