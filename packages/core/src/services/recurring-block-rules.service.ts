import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
	recurringBlockRule,
	recurringBlockRuleSkip,
	timeEntry,
} from "../db/schema/domain";
import {
	datesBetween,
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
		return created;
	},

	/** Turn the proposed daily break (`DEFAULT_BREAK_BLOCK`) into a real rule.
	 *
	 *  A separate entry point rather than the generic `create` because the caller
	 *  is a switch, not a form: the Break task is a site built-in resolved by
	 *  system key here, and it is deliberately not offered by
	 *  `tasksService.listForProject(ctx, undefined)`, so a client could not name
	 *  its id even if we wanted it to.
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
			const [resumed] = await db
				.update(recurringBlockRule)
				.set({ active: true, updatedAt: new Date() })
				.where(eq(recurringBlockRule.id, existing.id))
				.returning();
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
		if (input.active !== undefined) patch.active = input.active;

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

		const rows: (typeof timeEntry.$inferInsert)[] = [];
		for (const rule of rules) {
			for (const date of dates) {
				if (rule.effectiveFrom && date < rule.effectiveFrom) continue;
				if (rule.effectiveUntil && date > rule.effectiveUntil) continue;
				if (!rule.daysOfWeek.includes(weekdayByDate.get(date) ?? -1)) continue;
				if (skipSet.has(`${rule.id}:${date}`)) continue;

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
