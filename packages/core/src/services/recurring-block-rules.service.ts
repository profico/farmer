import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
	recurringBlockRule,
	recurringBlockRuleSkip,
	timeEntry,
} from "../db/schema/domain";
import { orgTimezone } from "../lib/org-time";
import { anchorDateTime, datesBetween, parseDuration, weekdayInTz } from "../lib/time";
import type {
	CreateRecurringBlockRuleInput,
	UpdateRecurringBlockRuleInput,
} from "../schema/recurring-block-rules";
import { entryTypesService } from "./entry-types.service";
import type { Ctx } from "./types";

export const recurringBlockRulesService = {
	list: (ctx: Ctx) => {
		return db.query.recurringBlockRule.findMany({
			where: and(
				eq(recurringBlockRule.organizationId, ctx.organizationId),
				eq(recurringBlockRule.userId, ctx.userId),
			),
			with: { type: true, project: true },
			orderBy: asc(recurringBlockRule.createdAt),
		});
	},

	create: async (ctx: Ctx, input: CreateRecurringBlockRuleInput) => {
		const available = await entryTypesService.listAvailable(ctx, {
			projectId: input.projectId,
		});
		if (!available.some((t) => t.id === input.typeId)) {
			throw new Error("Entry type not available");
		}
		const durationSeconds = parseDuration(input.duration);
		if (durationSeconds === null) {
			throw new Error("Could not understand that duration");
		}
		if (durationSeconds <= 0) {
			throw new Error("Duration must be greater than zero");
		}

		const [created] = await db
			.insert(recurringBlockRule)
			.values({
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				typeId: input.typeId,
				projectId: input.projectId,
				description: input.description ?? "",
				daysOfWeek: input.daysOfWeek,
				startTime: input.startTime,
				durationSeconds,
				effectiveFrom: input.effectiveFrom,
				effectiveUntil: input.effectiveUntil,
			})
			.returning();
		if (!created) throw new Error("Failed to create recurring block rule");
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

		if (input.typeId !== undefined || input.projectId !== undefined) {
			const projectId =
				input.projectId !== undefined
					? input.projectId
					: (existing.projectId ?? undefined);
			const typeId = input.typeId ?? existing.typeId;
			const available = await entryTypesService.listAvailable(ctx, {
				projectId,
			});
			if (!available.some((t) => t.id === typeId)) {
				throw new Error("Entry type not available");
			}
		}

		const patch: {
			typeId?: string;
			projectId?: string;
			description?: string;
			daysOfWeek?: number[];
			startTime?: string;
			durationSeconds?: number;
			effectiveFrom?: string;
			effectiveUntil?: string;
			active?: boolean;
		} = {};
		if (input.typeId !== undefined) patch.typeId = input.typeId;
		if (input.projectId !== undefined) patch.projectId = input.projectId;
		if (input.description !== undefined) patch.description = input.description;
		if (input.daysOfWeek !== undefined) patch.daysOfWeek = input.daysOfWeek;
		if (input.startTime !== undefined) patch.startTime = input.startTime;
		if (input.duration !== undefined) {
			const durationSeconds = parseDuration(input.duration);
			if (durationSeconds === null) {
				throw new Error("Could not understand that duration");
			}
			if (durationSeconds <= 0) {
				throw new Error("Duration must be greater than zero");
			}
			patch.durationSeconds = durationSeconds;
		}
		if (input.effectiveFrom !== undefined) {
			patch.effectiveFrom = input.effectiveFrom;
		}
		if (input.effectiveUntil !== undefined) {
			patch.effectiveUntil = input.effectiveUntil;
		}
		if (input.active !== undefined) patch.active = input.active;

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

		const tz = await orgTimezone(ctx.organizationId);
		const dates = datesBetween(from, to);
		const weekdayByDate = new Map(dates.map((d) => [d, weekdayInTz(d, tz)]));

		const rows: (typeof timeEntry.$inferInsert)[] = [];
		for (const rule of rules) {
			for (const date of dates) {
				if (rule.effectiveFrom && date < rule.effectiveFrom) continue;
				if (rule.effectiveUntil && date > rule.effectiveUntil) continue;
				if (!rule.daysOfWeek.includes(weekdayByDate.get(date) ?? -1)) continue;
				if (skipSet.has(`${rule.id}:${date}`)) continue;

				const startedAt = anchorDateTime(date, rule.startTime, tz);
				const stoppedAt = new Date(
					startedAt.getTime() + rule.durationSeconds * 1000,
				);

				rows.push({
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					projectId: rule.projectId,
					typeId: rule.typeId,
					description: rule.description,
					startedAt,
					stoppedAt,
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
