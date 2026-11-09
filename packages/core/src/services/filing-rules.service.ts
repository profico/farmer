import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "../db";
import { project, task, timeEntry } from "../db/schema/domain";
import {
	timeEntryGithubCommit,
	timeEntryGithubPrActivity,
} from "../db/schema/github";
import { filingRule } from "../db/schema/settings";
import { loggableError } from "../lib/loggable-error";
import type {
	DeleteFilingRuleInput,
	RememberFilingRuleInput,
	UpdateFilingRuleInput,
} from "../schema/filing-rules";
import { ctxAccess } from "./context";
import { assertProjectInOrg, assertTaskAvailable } from "./guards";
import type { Ctx } from "./types";

/** The next sync files a meeting on the project of a rule or on the fallback
 *  project. It must not be an archived project, as the picker does not offer
 *  one. */
export const assertProjectActive = async (ctx: Ctx, projectId: string) => {
	const live = await db.query.project.findFirst({
		where: and(
			eq(project.id, projectId),
			eq(project.organizationId, ctx.organizationId),
			eq(project.status, "active"),
		),
		columns: { id: true },
	});
	if (!live) {
		throw new Error("That project is archived. Pick another one.");
	}
};

/** The checks that apply after the project is known to be active: the person
 *  may track on it, it is in the org, and the task may go on it. */
const projectAcceptsTask = async (
	ctx: Ctx,
	access: Awaited<ReturnType<typeof ctxAccess>>,
	projectId: string,
	taskId: string,
) => {
	if (!access.canTrackOn(projectId)) return false;
	try {
		await assertProjectInOrg(ctx, projectId);
		await assertTaskAvailable(ctx, taskId, projectId);
		return true;
	} catch {
		return false;
	}
};

// Standing answers to "which project does this meeting belong to".
//
// The engines file nothing: a synced meeting lands project-less on purpose, and
// the File-your-time dialog is where a person attributes it. That is the right
// default and the wrong amount of work for the recurring case — a weekly
// stand-up is fifty rows of one answer a year, which is the complaint the
// grouping in that dialog only half fixes.
//
// A rule is the other half. `syncMeetingsForRange` applies it at write time, so
// a meeting arrives already filed and never shows up as unfiled at all; and
// Assemble my day applies it to every row it proposes without a project (a
// meeting, the break, the rest-of-day block), so an assembled day is filed as it
// is added.

/** The match key. Trim + lower-case, and nothing else: two people typing the
 *  same meeting name with different capitalisation mean the same meeting, and
 *  anything cleverer (stripping punctuation, collapsing numbers) starts
 *  matching things the person never agreed to. */
export const filingRuleKey = (title: string) => title.trim().toLowerCase();

/** The longest key that becomes a rule. The unique index on the key has a
 *  btree row limit of 2704 bytes. A character takes at most 4 bytes in UTF-8,
 *  so 500 characters and three uuids stay under the limit. */
export const MAX_FILING_RULE_KEY_LENGTH = 500;

/** Where a matching entry goes: a project, and the task it is filed under. */
export type FilingTarget = { projectId: string; taskId: string };

/** The key `resolve` answers on: the task the entry was written with, and its
 *  title. */
export const ruleKeyFor = (taskId: string, title: string) =>
	`${taskId}|${filingRuleKey(title)}`;

const targetTask = alias(task, "target_task");

/** The ids, out of these entries, that must not become a rule: a fill block,
 *  or an entry that holds commit or pull request evidence. */
const entriesWithoutRuleMatch = async (
	ctx: Ctx,
	entries: { timeEntryId?: string }[],
): Promise<Set<string>> => {
	const ids = entries.flatMap((e) => (e.timeEntryId ? [e.timeEntryId] : []));
	if (ids.length === 0) return new Set();
	const [fills, commits, activity] = await Promise.all([
		db
			.select({ id: timeEntry.id })
			.from(timeEntry)
			.where(
				and(
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, ctx.userId),
					inArray(timeEntry.id, ids),
					eq(timeEntry.fillsDay, true),
				),
			),
		db
			.selectDistinct({ id: timeEntryGithubCommit.timeEntryId })
			.from(timeEntryGithubCommit)
			.where(inArray(timeEntryGithubCommit.timeEntryId, ids)),
		db
			.selectDistinct({ id: timeEntryGithubPrActivity.timeEntryId })
			.from(timeEntryGithubPrActivity)
			.where(inArray(timeEntryGithubPrActivity.timeEntryId, ids)),
	]);
	return new Set([...fills, ...commits, ...activity].map((row) => row.id));
};

export const filingRulesService = {
	/** The caller's own rules, with the names needed to render them. */
	list: async (ctx: Ctx) =>
		db
			.select({
				id: filingRule.id,
				title: filingRule.title,
				taskId: filingRule.taskId,
				taskName: task.name,
				targetTaskId: filingRule.targetTaskId,
				targetTaskName: targetTask.name,
				projectId: filingRule.projectId,
				projectName: project.name,
				projectCode: project.code,
				createdAt: filingRule.createdAt,
			})
			.from(filingRule)
			.innerJoin(task, eq(filingRule.taskId, task.id))
			.innerJoin(project, eq(filingRule.projectId, project.id))
			.leftJoin(targetTask, eq(filingRule.targetTaskId, targetTask.id))
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
	 * `taskId` on an entry is the task it had BEFORE filing — the one the sync
	 * writes and matches on. `targetTaskId` is the task it was filed under, when
	 * the filing changed it.
	 *
	 * An entry with `timeEntryId` is checked first: a rest-of-day block, or one
	 * with GitHub commits or pull request events on it, carries a description
	 * the commit engine wrote from that evidence. It is a list of subjects that
	 * never comes back word for word, so a rule keyed on it matches nothing.
	 *
	 * Best-effort and never throws: the filing itself already succeeded, and
	 * failing the whole call because a preference could not be saved would report
	 * an error for work that was done.
	 */
	rememberFrom: async (
		ctx: Ctx,
		target: { projectId: string; targetTaskId?: string },
		entries: { timeEntryId?: string; taskId: string; description: string }[],
	) => {
		let skipped: Set<string>;
		try {
			skipped = await entriesWithoutRuleMatch(ctx, entries);
		} catch (error) {
			// Without the check an evidence-bearing entry could become a rule, so
			// remember nothing rather than guess.
			console.error(
				"[filing-rules] could not check entries",
				loggableError(error),
			);
			return 0;
		}
		// One row per distinct (task, title). A month of stand-ups is one rule.
		const byKey = new Map<
			string,
			{ taskId: string; titleKey: string; title: string }
		>();
		for (const entry of entries) {
			if (entry.timeEntryId && skipped.has(entry.timeEntryId)) continue;
			const title = entry.description.trim();
			// An empty description is not a rule. The dialog falls back to the task
			// name for display, so a rule keyed on "" would read as "always file
			// Meeting to X" and then claim every untitled meeting the sync imports —
			// which is the one-default-project behaviour this feature exists instead
			// of.
			if (!title) continue;
			const titleKey = filingRuleKey(title);
			// A very long title is a list of commit subjects, not a meeting. It never
			// repeats word for word, so it is not a useful rule. It also does not fit
			// the btree limit of the unique index, and one such row used to fail the
			// insert for the whole batch. The entry itself is already filed; a later
			// entry with the same title only gets no rule.
			if (titleKey.length > MAX_FILING_RULE_KEY_LENGTH) continue;
			byKey.set(`${entry.taskId}|${titleKey}`, {
				taskId: entry.taskId,
				titleKey,
				title,
			});
		}
		if (byKey.size === 0) return 0;

		// A target equal to the key's own task is no change, and is stored as
		// none, so renaming nothing never reads as a rule about the task.
		const rows = [...byKey.values()].map((rule) => ({
			organizationId: ctx.organizationId,
			userId: ctx.userId,
			projectId: target.projectId,
			targetTaskId:
				target.targetTaskId && target.targetTaskId !== rule.taskId
					? target.targetTaskId
					: null,
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
					projectId: target.projectId,
					targetTaskId: sql`excluded.target_task_id`,
					// Refreshes the display casing to whatever the person just saw.
					title: sql`excluded.title`,
					updatedAt: new Date(),
				},
			});
		return rows.length;
	},

	/**
	 * Make rules from entries the caller already filed, with no project or title
	 * from the caller. The assistant uses it: `rememberFrom` trusts its target,
	 * so this reads the caller's OWN entries and uses the project each one is on.
	 * An entry with no project, and an id that is not the caller's, adds no
	 * rule. The project must be live and the caller's to work on, because the
	 * next sync files a meeting there.
	 */
	rememberFromEntries: async (ctx: Ctx, input: RememberFilingRuleInput) => {
		const ids = [...new Set(input.timeEntryIds)];
		const rows = await db
			.select({
				id: timeEntry.id,
				projectId: timeEntry.projectId,
				taskId: timeEntry.taskId,
				description: timeEntry.description,
			})
			.from(timeEntry)
			.where(
				and(
					inArray(timeEntry.id, ids),
					eq(timeEntry.organizationId, ctx.organizationId),
					eq(timeEntry.userId, ctx.userId),
				),
			);

		const byProject = new Map<
			string,
			{ timeEntryId: string; taskId: string; description: string }[]
		>();
		for (const row of rows) {
			if (!row.projectId) continue;
			const group = byProject.get(row.projectId) ?? [];
			group.push({
				timeEntryId: row.id,
				taskId: row.taskId,
				description: row.description,
			});
			byProject.set(row.projectId, group);
		}

		const access = await ctxAccess(ctx);
		// Every project is checked before any rule is written, so one refused
		// project leaves the batch unwritten.
		for (const projectId of byProject.keys()) {
			await assertProjectInOrg(ctx, projectId);
			await assertProjectActive(ctx, projectId);
			access.assertCanTrackOn(projectId);
		}
		let remembered = 0;
		for (const [projectId, entries] of byProject) {
			remembered += await filingRulesService.rememberFrom(
				ctx,
				{ projectId },
				entries,
			);
		}
		return {
			remembered,
			// Own entries found, and how many of those had no project.
			entriesFound: rows.length,
			unfiled: rows.filter((row) => !row.projectId).length,
		};
	},

	/**
	 * Change where a rule files its meetings. The same checks as filing by hand,
	 * because the next sync writes exactly this: the project must be live and the
	 * person's, and the task one that may go on a project.
	 */
	update: async (ctx: Ctx, input: UpdateFilingRuleInput) => {
		const existing = await db.query.filingRule.findFirst({
			where: and(
				eq(filingRule.id, input.id),
				eq(filingRule.organizationId, ctx.organizationId),
				eq(filingRule.userId, ctx.userId),
			),
			columns: { id: true, taskId: true },
		});
		if (!existing) throw new Error("Filing rule not found");

		await assertProjectInOrg(ctx, input.projectId);
		await assertProjectActive(ctx, input.projectId);
		const access = await ctxAccess(ctx);
		access.assertCanTrackOn(input.projectId);
		const targetTaskId =
			input.targetTaskId && input.targetTaskId !== existing.taskId
				? input.targetTaskId
				: null;
		await assertTaskAvailable(
			ctx,
			targetTaskId ?? existing.taskId,
			input.projectId,
		);

		const [updated] = await db
			.update(filingRule)
			.set({ projectId: input.projectId, targetTaskId, updatedAt: new Date() })
			.where(eq(filingRule.id, existing.id))
			.returning({ id: filingRule.id });
		if (!updated) throw new Error("Filing rule not found");
		return updated;
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
	 * The engine-facing half: `ruleKeyFor(task, title) -> where it goes` for the
	 * given tasks, already filtered to projects the person may still write to.
	 *
	 * Re-checked rather than trusted, because a rule outlives the assignment that
	 * made it valid — being taken off a project does not delete the rules naming
	 * it, and a rule that quietly kept filing hours onto a project somebody is no
	 * longer on is the failure mode worth spending two queries to avoid. A rule
	 * that no longer applies is dropped silently: the entry lands unfiled, which
	 * is the same place it would have landed with no rule at all, and the person
	 * sees it in the dialog rather than getting a sync error about a preference.
	 * A rule whose target task was archived is dropped whole for the same reason,
	 * rather than filed under a task the person did not choose.
	 */
	resolve: async (
		ctx: Ctx,
		taskIds: string[],
	): Promise<Map<string, FilingTarget>> => {
		if (taskIds.length === 0) return new Map();
		const rules = await db
			.select({
				taskId: filingRule.taskId,
				titleKey: filingRule.titleKey,
				projectId: filingRule.projectId,
				targetTaskId: filingRule.targetTaskId,
			})
			.from(filingRule)
			.where(
				and(
					eq(filingRule.organizationId, ctx.organizationId),
					eq(filingRule.userId, ctx.userId),
					inArray(filingRule.taskId, taskIds),
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

		// Per (project, task) pair, since a dozen rules usually name two or three.
		const checked = new Map<string, boolean>();
		const usable = async (projectId: string, fileAs: string) => {
			const key = `${projectId}|${fileAs}`;
			const known = checked.get(key);
			if (known !== undefined) return known;
			const ok =
				liveIds.has(projectId) &&
				(await projectAcceptsTask(ctx, access, projectId, fileAs));
			checked.set(key, ok);
			return ok;
		};

		const resolved = new Map<string, FilingTarget>();
		for (const rule of rules) {
			const fileAs = rule.targetTaskId ?? rule.taskId;
			if (!(await usable(rule.projectId, fileAs))) continue;
			// The stored key is already normalized, so the title passes through.
			resolved.set(ruleKeyFor(rule.taskId, rule.titleKey), {
				projectId: rule.projectId,
				taskId: fileAs,
			});
		}
		return resolved;
	},

	/**
	 * The person's fallback project for a meeting that no rule matches, or null.
	 * It passes the same checks as the project of a rule, and it is dropped
	 * silently when one fails, so the meeting lands with no project.
	 */
	usableFallback: async (
		ctx: Ctx,
		projectId: string | null,
		taskId: string,
	): Promise<string | null> => {
		if (!projectId) return null;
		const live = await assertProjectActive(ctx, projectId).then(
			() => true,
			() => false,
		);
		if (!live) return null;
		const access = await ctxAccess(ctx);
		return (await projectAcceptsTask(ctx, access, projectId, taskId))
			? projectId
			: null;
	},
};
