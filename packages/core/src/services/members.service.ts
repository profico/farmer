import { and, asc, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm";

import { db } from "../db";
import { member, user } from "../db/schema/auth";
import { memberProfile, memberTypeHistory } from "../db/schema/people";
import { endOfMonthKey } from "../lib/time";
import type { SetMemberTypeInput } from "../schema/members";
import { requireAdmin } from "./context";
import { assertUserInOrg } from "./guards";
import type { Ctx } from "./types";

export type MemberType = "billable" | "overhead" | "contractor";

export type ResolvedMemberType = {
	type: MemberType;
	/** Contractors have no Croatian monthly hour fund and therefore no Expected
	 *  value — the "/" rows of the old sheet — unless one is set here, in which
	 *  case pace and utilization treat them like a billable person. */
	expectedSecondsOverride: number | null;
};

export type PersonRow = ResolvedMemberType & {
	userId: string;
	name: string;
	email: string;
	orgRole: string;
	startDate: string | null;
	/** Null = Active. Archived people keep every entry, close row and report they
	 *  already appear in, and drop out of the forward-looking ones. */
	archivedAt: Date | null;
};

const DEFAULT_TYPE: ResolvedMemberType = {
	type: "billable",
	expectedSecondsOverride: null,
};

/** People whose time we sell, i.e. who the compliance report, Slack reminders,
 *  "not on the invoice" and utilization apply to. Overhead is excluded from all
 *  of them; contractors from some. */
export const isNaggable = (type: MemberType) => type !== "overhead";

export const membersService = {
	getRole: async (ctx: Ctx): Promise<string | null> => {
		const row = await db.query.member.findFirst({
			where: and(
				eq(member.organizationId, ctx.organizationId),
				eq(member.userId, ctx.userId),
			),
		});
		return row?.role ?? null;
	},

	/** Every person in the org with their CURRENT type. For historical reporting
	 *  use `typesAsOf` instead — type changes are effective-dated precisely so a
	 *  past month reflects the type the person held then. */
	list: async (ctx: Ctx): Promise<PersonRow[]> => {
		const rows = await db
			.select({
				userId: member.userId,
				name: user.name,
				email: user.email,
				orgRole: member.role,
				startDate: memberProfile.startDate,
				archivedAt: memberProfile.archivedAt,
				type: memberTypeHistory.type,
				expectedSecondsOverride: memberTypeHistory.expectedSecondsOverride,
			})
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.leftJoin(
				memberProfile,
				and(
					eq(memberProfile.organizationId, member.organizationId),
					eq(memberProfile.userId, member.userId),
				),
			)
			.leftJoin(
				memberTypeHistory,
				and(
					eq(memberTypeHistory.organizationId, member.organizationId),
					eq(memberTypeHistory.userId, member.userId),
					isNull(memberTypeHistory.effectiveUntil),
				),
			)
			.where(eq(member.organizationId, ctx.organizationId))
			.orderBy(asc(user.name));

		return rows.map((r) => ({
			userId: r.userId,
			name: r.name,
			email: r.email,
			orgRole: r.orgRole,
			startDate: r.startDate ?? null,
			archivedAt: r.archivedAt ?? null,
			// A person with no history row yet is Billable — the default, and the
			// right one: delivery people are the common case.
			type: r.type ?? DEFAULT_TYPE.type,
			expectedSecondsOverride: r.expectedSecondsOverride ?? null,
		}));
	},

	/** Resolve every person's type as it stood on `asOf` (yyyy-MM-dd). This is
	 *  what every report must use: the known real case is a contractor becoming
	 *  an employee, and a report for a past month has to reflect the type the
	 *  person held at that time, not today's. */
	typesAsOf: async (
		ctx: Ctx,
		asOf: string,
	): Promise<Map<string, ResolvedMemberType>> => {
		const rows = await db
			.select({
				userId: memberTypeHistory.userId,
				type: memberTypeHistory.type,
				expectedSecondsOverride: memberTypeHistory.expectedSecondsOverride,
			})
			.from(memberTypeHistory)
			.where(
				and(
					eq(memberTypeHistory.organizationId, ctx.organizationId),
					lte(memberTypeHistory.effectiveFrom, asOf),
					or(
						isNull(memberTypeHistory.effectiveUntil),
						gt(memberTypeHistory.effectiveUntil, asOf),
					),
				),
			);

		// The mth_current_uidx + closed-range invariant (see setType) guarantees at
		// most one match per user, so a plain Map build is safe.
		return new Map(
			rows.map((r) => [
				r.userId,
				{
					type: r.type,
					expectedSecondsOverride: r.expectedSecondsOverride ?? null,
				},
			]),
		);
	},

	/** Same, for a calendar month. Resolved as of the LAST day of the month: a
	 *  person who converts mid-month is reported under the type they finished it
	 *  under, which matches how the close sheet is read. */
	typesForMonth: async (ctx: Ctx, year: number, month: number) =>
		membersService.typesAsOf(
			ctx,
			endOfMonthKey(`${year}-${String(month).padStart(2, "0")}-01`),
		),

	typeFor: async (
		ctx: Ctx,
		userId: string,
		asOf: string,
	): Promise<ResolvedMemberType> => {
		const all = await membersService.typesAsOf(ctx, asOf);
		return all.get(userId) ?? DEFAULT_TYPE;
	},

	/** Change a person's type from `effectiveFrom` onward, preserving history.
	 *  Closing the previous open row and opening the new one happen in one
	 *  transaction — that pairing is what keeps `mth_current_uidx` (at most one
	 *  open-ended row per person) satisfiable. */
	setType: async (ctx: Ctx, input: SetMemberTypeInput) => {
		await requireAdmin(ctx);
		await assertUserInOrg(ctx, input.userId);

		await db.transaction(async (tx) => {
			const current = await tx.query.memberTypeHistory.findFirst({
				where: and(
					eq(memberTypeHistory.organizationId, ctx.organizationId),
					eq(memberTypeHistory.userId, input.userId),
					isNull(memberTypeHistory.effectiveUntil),
				),
			});

			if (current) {
				// Re-stating the same type from the same date is a no-op edit of the
				// current row, not a new historical segment — otherwise correcting a
				// typo in the override would litter the history with zero-length rows
				// (which the mth_range_valid CHECK rejects anyway).
				if (current.effectiveFrom >= input.effectiveFrom) {
					await tx
						.update(memberTypeHistory)
						.set({
							type: input.type,
							expectedSecondsOverride: input.expectedSecondsOverride ?? null,
							effectiveFrom: input.effectiveFrom,
							updatedAt: new Date(),
						})
						.where(eq(memberTypeHistory.id, current.id));
					return;
				}
				await tx
					.update(memberTypeHistory)
					.set({ effectiveUntil: input.effectiveFrom, updatedAt: new Date() })
					.where(eq(memberTypeHistory.id, current.id));
			}

			await tx.insert(memberTypeHistory).values({
				organizationId: ctx.organizationId,
				userId: input.userId,
				type: input.type,
				expectedSecondsOverride: input.expectedSecondsOverride ?? null,
				effectiveFrom: input.effectiveFrom,
			});
		});
	},

	/** The people who have left. Every forward-looking surface — compliance, the
	 *  Slack nudges behind it, utilization, "not on the invoice", the assignment
	 *  picker — subtracts this set; nothing historical does. */
	archivedUserIds: async (ctx: Ctx): Promise<Set<string>> => {
		const rows = await db
			.select({ userId: memberProfile.userId })
			.from(memberProfile)
			.where(
				and(
					eq(memberProfile.organizationId, ctx.organizationId),
					isNotNull(memberProfile.archivedAt),
				),
			);
		return new Set(rows.map((r) => r.userId));
	},

	/** Archive or restore a person. Never a delete: their entries, close rows and
	 *  finalized months have to survive them leaving. */
	setArchived: async (ctx: Ctx, userId: string, archived: boolean) => {
		await requireAdmin(ctx);
		await assertUserInOrg(ctx, userId);
		// Archiving yourself would drop you out of the very lists you administer
		// while leaving you logged in — a state with no way back through the UI.
		if (archived && userId === ctx.userId) {
			throw new Error("You cannot archive yourself");
		}
		const archivedAt = archived ? new Date() : null;
		await db
			.insert(memberProfile)
			.values({ organizationId: ctx.organizationId, userId, archivedAt })
			.onConflictDoUpdate({
				target: [memberProfile.organizationId, memberProfile.userId],
				set: { archivedAt, updatedAt: new Date() },
			});
	},

	setStartDate: async (ctx: Ctx, userId: string, startDate: string | null) => {
		await requireAdmin(ctx);
		await assertUserInOrg(ctx, userId);
		await db
			.insert(memberProfile)
			.values({ organizationId: ctx.organizationId, userId, startDate })
			.onConflictDoUpdate({
				target: [memberProfile.organizationId, memberProfile.userId],
				set: { startDate, updatedAt: new Date() },
			});
	},

	/** Type history for one person, newest first — the audit trail behind
	 *  "why does last March say contractor?". */
	typeHistory: async (ctx: Ctx, userId: string) => {
		await requireAdmin(ctx);
		return db.query.memberTypeHistory.findMany({
			where: and(
				eq(memberTypeHistory.organizationId, ctx.organizationId),
				eq(memberTypeHistory.userId, userId),
			),
			orderBy: asc(memberTypeHistory.effectiveFrom),
		});
	},
};
