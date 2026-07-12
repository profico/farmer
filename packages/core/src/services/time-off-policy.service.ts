import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { member } from "../db/schema/auth";
import {
	memberTimeOffAllowance,
	timeOffPolicy,
} from "../db/schema/schedule";
import type {
	SetMemberAllowanceInput,
	UpdateTimeOffPolicyInput,
} from "../schema/time-off-policy";
import type { Ctx } from "./types";

export type TimeOffPolicy = {
	defaultAllowanceDays: number;
	carryoverEnabled: boolean;
	carryoverMaxDays: number | null;
	carryoverExpiryMonth: number;
	carryoverExpiryDay: number;
};

// Applied when an org has no time_off_policy row yet — mirrors the column
// defaults so a missing row behaves identically to an unedited one.
const DEFAULTS: TimeOffPolicy = {
	defaultAllowanceDays: 20,
	carryoverEnabled: true,
	carryoverMaxDays: null,
	carryoverExpiryMonth: 3,
	carryoverExpiryDay: 31,
};

export type MemberAllowance = {
	userId: string;
	name: string;
	email: string;
	override: number | null;
	effective: number;
};

export const timeOffPolicyService = {
	getPolicy: async (ctx: Ctx): Promise<TimeOffPolicy> => {
		const row = await db.query.timeOffPolicy.findFirst({
			where: eq(timeOffPolicy.organizationId, ctx.organizationId),
		});
		if (!row) return { ...DEFAULTS };
		return {
			defaultAllowanceDays: row.defaultAllowanceDays,
			carryoverEnabled: row.carryoverEnabled,
			carryoverMaxDays: row.carryoverMaxDays,
			carryoverExpiryMonth: row.carryoverExpiryMonth,
			carryoverExpiryDay: row.carryoverExpiryDay,
		};
	},

	updatePolicy: async (
		ctx: Ctx,
		input: UpdateTimeOffPolicyInput,
	): Promise<TimeOffPolicy> => {
		const [row] = await db
			.insert(timeOffPolicy)
			.values({
				organizationId: ctx.organizationId,
				defaultAllowanceDays: input.defaultAllowanceDays,
				carryoverEnabled: input.carryoverEnabled,
				carryoverMaxDays: input.carryoverMaxDays,
				carryoverExpiryMonth: input.carryoverExpiryMonth,
				carryoverExpiryDay: input.carryoverExpiryDay,
			})
			.onConflictDoUpdate({
				target: [timeOffPolicy.organizationId],
				set: {
					defaultAllowanceDays: input.defaultAllowanceDays,
					carryoverEnabled: input.carryoverEnabled,
					carryoverMaxDays: input.carryoverMaxDays,
					carryoverExpiryMonth: input.carryoverExpiryMonth,
					carryoverExpiryDay: input.carryoverExpiryDay,
					updatedAt: new Date(),
				},
			})
			.returning();
		if (!row) throw new Error("Failed to save time off policy");
		return {
			defaultAllowanceDays: row.defaultAllowanceDays,
			carryoverEnabled: row.carryoverEnabled,
			carryoverMaxDays: row.carryoverMaxDays,
			carryoverExpiryMonth: row.carryoverExpiryMonth,
			carryoverExpiryDay: row.carryoverExpiryDay,
		};
	},

	// A member's effective yearly vacation allowance: their override if set,
	// otherwise the org policy default.
	getMemberAllowanceDays: async (
		ctx: Ctx,
		userId: string,
	): Promise<number> => {
		const [override, policy] = await Promise.all([
			db.query.memberTimeOffAllowance.findFirst({
				where: and(
					eq(memberTimeOffAllowance.organizationId, ctx.organizationId),
					eq(memberTimeOffAllowance.userId, userId),
				),
			}),
			timeOffPolicyService.getPolicy(ctx),
		]);
		return override?.allowanceDays ?? policy.defaultAllowanceDays;
	},

	listMemberAllowances: async (ctx: Ctx): Promise<MemberAllowance[]> => {
		const [members, overrides, policy] = await Promise.all([
			db.query.member.findMany({
				where: eq(member.organizationId, ctx.organizationId),
				with: { user: true },
			}),
			db
				.select({
					userId: memberTimeOffAllowance.userId,
					allowanceDays: memberTimeOffAllowance.allowanceDays,
				})
				.from(memberTimeOffAllowance)
				.where(eq(memberTimeOffAllowance.organizationId, ctx.organizationId)),
			timeOffPolicyService.getPolicy(ctx),
		]);
		const overrideByUser = new Map(
			overrides.map((o) => [o.userId, o.allowanceDays]),
		);
		return members.map((m) => {
			const override = overrideByUser.get(m.userId) ?? null;
			return {
				userId: m.userId,
				name: m.user.name,
				email: m.user.email,
				override,
				effective: override ?? policy.defaultAllowanceDays,
			};
		});
	},

	// null clears the override (fall back to policy default); a number sets it.
	setMemberAllowance: async (
		ctx: Ctx,
		input: SetMemberAllowanceInput,
	): Promise<void> => {
		if (input.allowanceDays === null) {
			await db
				.delete(memberTimeOffAllowance)
				.where(
					and(
						eq(memberTimeOffAllowance.organizationId, ctx.organizationId),
						eq(memberTimeOffAllowance.userId, input.userId),
					),
				);
			return;
		}
		await db
			.insert(memberTimeOffAllowance)
			.values({
				organizationId: ctx.organizationId,
				userId: input.userId,
				allowanceDays: input.allowanceDays,
			})
			.onConflictDoUpdate({
				target: [
					memberTimeOffAllowance.organizationId,
					memberTimeOffAllowance.userId,
				],
				set: { allowanceDays: input.allowanceDays, updatedAt: new Date() },
			});
	},
};
