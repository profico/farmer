import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
	recurringBlockRule,
	recurringBlockRuleSkip,
	timeEntry,
} from "../db/schema/domain";
import { automationWriteWindow } from "../lib/automation-window";
import {
	datesBetween,
	dayKeyInTz,
	parseDuration,
	QUARTER_HOUR_SECONDS,
	weekdayInTz,
} from "../lib/time";
import {
	type CreateRecurringBlockRuleInput,
	DEFAULT_BREAK_BLOCK,
	type UpdateRecurringBlockRuleInput,
} from "../schema/recurring-block-rules";
import { ctxTimezone } from "./context";
import { assertTaskAvailable } from "./guards";
import { orgSettingsService } from "./org-settings.service";
import { tasksService } from "./tasks.service";
import type { Ctx } from "./types";

// A recurring rule is now "N hours of task T on these weekdays", with no clock:
// under the duration-only entry model there is no time of day to place it at.
// Everything else about the rule — effective dating, per-date skips, idempotent
// materialization — is unchanged.
const parseRuleDuration = (input: string): number => {
	const seconds = parseDuration(input);
	if (seconds === null) throw new Error("Could not understand that duration");
	if (seconds <= 0) throw new Error("Duration must be greater than zero");
	if (seconds % QUARTER_HOUR_SECONDS !== 0) {
		throw new Error("Duration must be in 15-minute steps");
	}
	return seconds;
};

/**
 * Bring this person's blocks up to date right now, over the standard automation
 * window.
 *
 * The worker materializes on a timer, which is right for the steady state and
 * wrong for the moment somebody creates a rule: waiting out a tick to see
 * today's break appear reads as a broken switch. So the mutations below call
 * this — a user action explicitly asking for these blocks, not a page load
 * quietly doing it. Cheap and purely local: no network, no external API.
 *
 * Best-effort. Failing to materialize must never fail the rule that was just
 * saved; the next tick picks it up.
 */
const materializeNow = async (ctx: Ctx) => {
	try {
		const tz = await ctxTimezone(ctx);
		const { automationLockedThrough } = await orgSettingsService.get(ctx);
		const window = automationWriteWindow(dayKeyInTz(new Date(), tz), {
			lockedThrough: automationLockedThrough,
		});
		if (!window) return;
		await recurringBlockRulesService.materializeRange(
			ctx,
			window.from,
			window.to,
		);
	} catch (error) {
		console.error("[recurring-blocks] immediate materialize failed", error);
	}
};

export const recurringBlockRulesService = {
	list: (ctx: Ctx) =>
		db.query.recurringBlockRule.findMany({
			where: and(
				eq(recurringBlockRule.organizationId, ctx.organizationId),
				eq(recurringBlockRule.userId, ctx.userId),
			),
			with: { task: true, project: true },
			orderBy: asc(recurringBlockRule.createdAt),
		}),

	create: async (ctx: Ctx, input: CreateRecurringBlockRuleInput) => {
		// Same taxonomy gate as a hand-made entry: the rule can only produce
		// entries the user could have created themselves.
		await assertTaskAvailable(ctx, input.taskId, input.projectId);
		const durationSeconds = parseRuleDuration(input.duration);

		const [created] = await db
			.insert(recurringBlockRule)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				taskId: input.taskId,
				projectId: input.projectId,
				description: input.description ?? "",
				daysOfWeek: input.daysOfWeek,
				durationSeconds,
				effectiveFrom: input.effectiveFrom,
				effectiveUntil: input.effectiveUntil,
			})
			.returning();
		if (!created) throw new Error("Failed to create recurring block rule");
		await materializeNow(ctx);
		return created;
	},

	/** Turn the proposed daily break (`DEFAULT_BREAK_BLOCK`) into a real rule.
	 *
	 *  A separate entry point rather than the generic `create` because the caller
	 *  is a switch, not a form: it names no task, no days and no duration, so the
	 *  Break task is resolved by system key here rather than by an id the client
	 *  had to send. The same rule is writable through `create` — the "No project"
	 *  task list offers Break like any other built-in — this is just the one-click
	 *  path to the shape everybody wants.
	 *
	 *  Idempotent. The page only shows the switch when no break rule exists, but a
	 *  double click or a second tab must not leave someone with two breaks a day —
	 *  so an existing rule is resumed instead of duplicated. */
	enableBreak: async (ctx: Ctx) => {
		const breakTask = await tasksService.findBySystemKey(ctx, "break");
		if (!breakTask) throw new Error("The Break task is missing");

		const existing = await db.query.recurringBlockRule.findFirst({
			where: and(
				eq(recurringBlockRule.organizationId, ctx.organizationId),
				eq(recurringBlockRule.userId, ctx.userId),
				eq(recurringBlockRule.taskId, breakTask.id),
			),
		});
		if (existing) {
			if (existing.active) return existing;
			const now = new Date();
			const [resumed] = await db
				.update(recurringBlockRule)
				.set({ active: true, activeSince: now, updatedAt: now })
				.where(eq(recurringBlockRule.id, existing.id))
				.returning();
			await materializeNow(ctx);
			return resumed ?? existing;
		}

		// No project, like every break the day assembler proposes: a break is time
		// off the clock, not work anyone can attribute to a client.
		const [created] = await db
			.insert(recurringBlockRule)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				taskId: breakTask.id,
				description: DEFAULT_BREAK_BLOCK.description,
				daysOfWeek: [...DEFAULT_BREAK_BLOCK.daysOfWeek],
				durationSeconds: DEFAULT_BREAK_BLOCK.durationSeconds,
			})
			.returning();
		if (!created) throw new Error("Failed to create the break block");
		await materializeNow(ctx);
		return created;
	},

	update: async (ctx: Ctx, input: UpdateRecurringBlockRuleInput) => {
		const existing = await db.query.recurringBlockRule.findFirst({
			where: and(
				eq(recurringBlockRule.id, input.ruleId),
				eq(recurringBlockRule.organizationId, ctx.organizationId),
				eq(recurringBlockRule.userId, ctx.userId),
			),
		});
		if (!existing) throw new Error("Recurring block rule not found");

		if (input.taskId !== undefined || input.projectId !== undefined) {
			await assertTaskAvailable(
				ctx,
				input.taskId ?? existing.taskId,
				(input.projectId !== undefined
					? input.projectId
					: existing.projectId) ?? undefined,
			);
		}

		const patch: Partial<typeof recurringBlockRule.$inferInsert> = {
			updatedAt: new Date(),
		};
		if (input.taskId !== undefined) patch.taskId = input.taskId;
		if (input.projectId !== undefined) patch.projectId = input.projectId;
		if (input.description !== undefined) patch.description = input.description;
		if (input.daysOfWeek !== undefined) patch.daysOfWeek = input.daysOfWeek;
		if (input.duration !== undefined) {
			patch.durationSeconds = parseRuleDuration(input.duration);
		}
		if (input.effectiveFrom !== undefined) {
			patch.effectiveFrom = input.effectiveFrom;
		}
		if (input.effectiveUntil !== undefined) {
			patch.effectiveUntil = input.effectiveUntil;
		}
		if (input.active !== undefined) {
			patch.active = input.active;
			// Resuming is switching on: the floor moves to today rather than
			// refilling every day the rule spent paused.
			if (input.active && !existing.active) patch.activeSince = new Date();
		}

		// Checked against the MERGED rule, not the patch: `update` is partial, so
		// neither field is necessarily present, and the pair only makes sense
		// together. Same rule as `createRecurringBlockRuleInput` enforces — a rule
		// that materializes worked time has to say what the work is, or the entries
		// it writes are ones the app itself would refuse to save.
		//
		// Rules created before this rule existed are grandfathered: they are only
		// caught here if something else about them is edited.
		const mergedProjectId =
			input.projectId !== undefined ? input.projectId : existing.projectId;
		const mergedDescription =
			input.description !== undefined
				? input.description
				: existing.description;
		if (mergedProjectId && !mergedDescription?.trim()) {
			throw new Error("Describe what this block is for");
		}

		const [updated] = await db
			.update(recurringBlockRule)
			.set(patch)
			.where(eq(recurringBlockRule.id, input.ruleId))
			.returning();
		// Only on the resume: an edit to shape or duration doesn't retroactively
		// rewrite blocks already on the calendar, and materializeRange skips any
		// day that already holds this rule's block.
		if (input.active && !existing.active) await materializeNow(ctx);
		return updated;
	},

	remove: async (ctx: Ctx, ruleId: string) => {
		await db
			.delete(recurringBlockRule)
			.where(
				and(
					eq(recurringBlockRule.id, ruleId),
					eq(recurringBlockRule.organizationId, ctx.organizationId),
					eq(recurringBlockRule.userId, ctx.userId),
				),
			);
	},

	// Idempotently ensures a real time_entry row exists for every (rule, date)
	// pair in [from, to] that the rule applies to and hasn't been skipped.
	materializeRange: async (ctx: Ctx, from: string, to: string) => {
		const rules = await db.query.recurringBlockRule.findMany({
			where: and(
				eq(recurringBlockRule.organizationId, ctx.organizationId),
				eq(recurringBlockRule.userId, ctx.userId),
				eq(recurringBlockRule.active, true),
				or(
					isNull(recurringBlockRule.effectiveFrom),
					lte(recurringBlockRule.effectiveFrom, to),
				),
				or(
					isNull(recurringBlockRule.effectiveUntil),
					gte(recurringBlockRule.effectiveUntil, from),
				),
			),
		});
		if (rules.length === 0) return;

		const skips = await db.query.recurringBlockRuleSkip.findMany({
			where: inArray(
				recurringBlockRuleSkip.ruleId,
				rules.map((r) => r.id),
			),
		});
		const skipSet = new Set(skips.map((s) => `${s.ruleId}:${s.date}`));

		const tz = await ctxTimezone(ctx);
		const dates = datesBetween(from, to);
		const weekdayByDate = new Map(dates.map((d) => [d, weekdayInTz(d, tz)]));

		// What the day already holds, so a rule cannot put a second copy of its own
		// block on it. `onConflictDoNothing` below only recognises an entry THIS
		// rule generated — so a break that arrived any other way (the day assembler
		// carving one, "copy from previous day" bringing one forward, or someone
		// logging one by hand) was invisible to it, and the rule added a second
		// break to a day that plainly already had one. The day assembler has always
		// made this check before proposing its break; the materializer never did.
		const existing = await db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.organizationId, ctx.organizationId),
				eq(timeEntry.userId, ctx.userId),
				gte(timeEntry.date, from),
				lte(timeEntry.date, to),
			),
			columns: { date: true, taskId: true, projectId: true },
		});
		// Two keys, because "is this block already here?" has two answers depending
		// on whether the rule names a project.
		//
		// A rule WITH a project is project-specific: two rules for the same task on
		// different projects are different blocks and a day may legitimately hold
		// both, so it only recognises its own project's entry.
		//
		// A rule with NO project — every break rule, since a break is time off the
		// clock that nobody can attribute to a client — matches on the task alone.
		// It has to: this key used to be project-qualified in both directions, so a
		// break someone had already logged against a project was invisible to the
		// break rule, and the rule filed a second, project-less one next to it. That
		// is not two blocks, it is one break counted twice, and it is what the
		// materializer's own guard was added to prevent.
		const taskKey = (e: { date: string; taskId: string }) =>
			`${e.date}|${e.taskId}`;
		const projectKey = (e: {
			date: string;
			taskId: string;
			projectId: string | null;
		}) => `${taskKey(e)}|${e.projectId ?? ""}`;
		const dayHasTask = new Set(existing.map(taskKey));
		const dayHasTaskOnProject = new Set(existing.map(projectKey));
		const dayAlreadyHas = (
			rule: {
				taskId: string;
				projectId: string | null;
			},
			date: string,
		) =>
			rule.projectId
				? dayHasTaskOnProject.has(projectKey({ ...rule, date }))
				: dayHasTask.has(taskKey({ ...rule, date }));

		const rows: (typeof timeEntry.$inferInsert)[] = [];
		for (const rule of rules) {
			// A rule never writes to a day before it was switched on. Without this
			// floor, turning the daily break on wrote one onto every past day the
			// time page was scrolled back to — silently editing months of
			// already-filed timesheets, including closed ones.
			//
			// `effectiveFrom` narrows further but cannot widen: it is how you say
			// "start next month", not a way back into the past. Nothing offers
			// backfill, because nobody asked for their history to be rewritten.
			const activeSince = dayKeyInTz(rule.activeSince, tz);
			const startsOn =
				rule.effectiveFrom && rule.effectiveFrom > activeSince
					? rule.effectiveFrom
					: activeSince;
			for (const date of dates) {
				if (date < startsOn) continue;
				if (rule.effectiveUntil && date > rule.effectiveUntil) continue;
				if (!rule.daysOfWeek.includes(weekdayByDate.get(date) ?? -1)) continue;
				if (skipSet.has(`${rule.id}:${date}`)) continue;
				if (dayAlreadyHas(rule, date)) continue;

				// Claimed as this batch goes, so two rules for the same block on the
				// same weekday produce one entry rather than racing each other. Both
				// sets, so the claim is visible to whichever question the next rule asks.
				dayHasTask.add(taskKey({ date, taskId: rule.taskId }));
				dayHasTaskOnProject.add(
					projectKey({ date, taskId: rule.taskId, projectId: rule.projectId }),
				);
				rows.push({
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					projectId: rule.projectId,
					taskId: rule.taskId,
					description: rule.description,
					date,
					durationSeconds: rule.durationSeconds,
					generatedFromRuleId: rule.id,
					generatedForDate: date,
				});
			}
		}
		if (rows.length === 0) return;

		await db
			.insert(timeEntry)
			.values(rows)
			.onConflictDoNothing({
				target: [timeEntry.generatedFromRuleId, timeEntry.generatedForDate],
				where: sql`${timeEntry.generatedFromRuleId} is not null`,
			});
	},
};
