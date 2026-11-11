// The AI usage ledger: what each billed model call cost, per organization and
// per person. Written beside each `AiGeneration` in `assistant.service.ts`, not
// through the telemetry sink, which must never wait or throw.

import { and, eq, gte, lt, sql } from "drizzle-orm";

import { db } from "../db";
import { assistantUsage } from "../db/schema/assistant";
import { loggableError } from "../lib/loggable-error";
import { dayBoundsInTz } from "../lib/time";
import {
	type AssistantUsageInput,
	assistantUsageInput,
} from "../schema/reports";
import { ctxTimezone, requireAdmin } from "./context";
import { membersService } from "./members.service";
import type { Ctx } from "./types";

export type AssistantUsageEntry = {
	conversationId: string;
	model: string;
	servedModel: string | null;
	kind: "turn" | "title";
	attempt: number;
	promptTokens: number | null;
	completionTokens: number | null;
	/** Null when the call has no usage row: unknown, not zero. */
	costUsd: number | null;
};

/** Write one ledger row. A failure is logged and never reaches the turn. */
export const recordAssistantUsage = async (
	ctx: Ctx,
	entry: AssistantUsageEntry,
): Promise<void> => {
	try {
		await db.insert(assistantUsage).values({
			organizationId: ctx.organizationId,
			userId: ctx.userId,
			...entry,
		});
	} catch (error) {
		console.error(
			"[assistant] usage ledger insert failed",
			loggableError(error),
		);
	}
};

export type UsageTotals = {
	calls: number;
	/** Calls with no known cost. They add nothing to `costUsd`. */
	unknownCostCalls: number;
	promptTokens: number;
	completionTokens: number;
	costUsd: number;
};

export type AssistantUsagePerson = UsageTotals & {
	userId: string;
	name: string;
	image: string | null;
};

export type AssistantUsageModel = UsageTotals & { model: string };

export type AssistantUsageSummary = {
	totals: UsageTotals;
	people: AssistantUsagePerson[];
	models: AssistantUsageModel[];
};

const totalsSql = {
	calls: sql<number>`count(*)::int`,
	unknownCostCalls: sql<number>`(count(*) filter (where ${assistantUsage.costUsd} is null))::int`,
	promptTokens: sql<number>`coalesce(sum(${assistantUsage.promptTokens}), 0)::int`,
	completionTokens: sql<number>`coalesce(sum(${assistantUsage.completionTokens}), 0)::int`,
	costUsd: sql<number>`coalesce(sum(${assistantUsage.costUsd}), 0)::float8`,
};

const byCostDesc = (a: UsageTotals, b: UsageTotals) => b.costUsd - a.costUsd;

const summary = async (
	ctx: Ctx,
	input: AssistantUsageInput,
): Promise<AssistantUsageSummary> => {
	await requireAdmin(ctx);
	const { from, to } = assistantUsageInput.parse(input);
	const tz = await ctxTimezone(ctx);
	const where = and(
		eq(assistantUsage.organizationId, ctx.organizationId),
		gte(assistantUsage.createdAt, dayBoundsInTz(from, tz).start),
		lt(assistantUsage.createdAt, dayBoundsInTz(to, tz).end),
	);

	const [[totals], personRows, modelRows, { members }] = await Promise.all([
		db.select(totalsSql).from(assistantUsage).where(where),
		db
			.select({ userId: assistantUsage.userId, ...totalsSql })
			.from(assistantUsage)
			.where(where)
			.groupBy(assistantUsage.userId),
		db
			.select({ model: assistantUsage.model, ...totalsSql })
			.from(assistantUsage)
			.where(where)
			.groupBy(assistantUsage.model),
		membersService.roster(ctx),
	]);

	const byUser = new Map(members.map((m) => [m.userId, m.user]));
	const people = personRows
		.map((row) => {
			const person = byUser.get(row.userId);
			return {
				...row,
				name: person?.name ?? "Removed person",
				image: person?.image ?? null,
			};
		})
		.sort(byCostDesc);

	return {
		totals: totals ?? {
			calls: 0,
			unknownCostCalls: 0,
			promptTokens: 0,
			completionTokens: 0,
			costUsd: 0,
		},
		people,
		models: modelRows.sort(byCostDesc),
	};
};

export const assistantUsageService = { summary };
