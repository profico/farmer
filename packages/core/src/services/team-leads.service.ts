import { and, asc, count, eq, inArray, isNotNull, or } from "drizzle-orm";

import { db } from "../db";
import { member, user } from "../db/schema/auth";
import { memberProfile, teamLeadPerson } from "../db/schema/people";
import type { SetTeamLeadPeopleInput } from "../schema/team-leads";
import { AccessError } from "./access.service";
import { ctxAccess, requireAdmin } from "./context";
import type { Ctx } from "./types";

// Team Lead people lists (§4, revised Sept 2026). Being a lead is having people
// on the list; an Admin edits it on the Members page. What the list grants is
// decided in `access.service.ts` — this only keeps the rows.
export const teamLeadsService = {
	/** The people on a lead's list, alphabetical. Admin, or the lead
	 *  themselves — a colleague's list is not yours to read. */
	listPeople: async (ctx: Ctx, leadUserId: string) => {
		const access = await ctxAccess(ctx);
		if (!access.isAdmin && leadUserId !== ctx.userId) {
			throw new AccessError("You cannot see another person's people");
		}
		return db
			.select({
				userId: teamLeadPerson.personUserId,
				name: user.name,
				email: user.email,
			})
			.from(teamLeadPerson)
			.innerJoin(user, eq(teamLeadPerson.personUserId, user.id))
			.where(
				and(
					eq(teamLeadPerson.organizationId, ctx.organizationId),
					eq(teamLeadPerson.leadUserId, leadUserId),
				),
			)
			.orderBy(asc(user.name));
	},

	/** How many people each lead has — one number per lead, leads only. */
	countsByLead: async (ctx: Ctx): Promise<Map<string, number>> => {
		await requireAdmin(ctx);
		const rows = await db
			.select({ leadUserId: teamLeadPerson.leadUserId, people: count() })
			.from(teamLeadPerson)
			.where(eq(teamLeadPerson.organizationId, ctx.organizationId))
			.groupBy(teamLeadPerson.leadUserId);
		return new Map(rows.map((r) => [r.leadUserId, Number(r.people)]));
	},

	/** Replace a lead's list wholesale. Admin only. Everyone named must be a
	 *  member of this organization — tenancy in the WHERE, as ever — and the
	 *  lead is never on their own list. Nobody named, lead or person, may be
	 *  archived: an archived person has left, and a stale list is exactly what
	 *  let a re-invited lead silently regain one (see `removeFromAllLists`). */
	setPeople: async (ctx: Ctx, input: SetTeamLeadPeopleInput) => {
		await requireAdmin(ctx);
		const personUserIds = [...new Set(input.personUserIds)].filter(
			(id) => id !== input.leadUserId,
		);
		const named = [input.leadUserId, ...personUserIds];
		const members = await db
			.select({ userId: member.userId })
			.from(member)
			.where(
				and(
					eq(member.organizationId, ctx.organizationId),
					inArray(member.userId, named),
				),
			);
		const here = new Set(members.map((m) => m.userId));
		const missing = named.find((id) => !here.has(id));
		if (missing !== undefined) {
			throw new AccessError(
				"Everyone on a list must be a member of this workspace",
			);
		}
		const archived = await db
			.select({ userId: memberProfile.userId })
			.from(memberProfile)
			.where(
				and(
					eq(memberProfile.organizationId, ctx.organizationId),
					inArray(memberProfile.userId, named),
					isNotNull(memberProfile.archivedAt),
				),
			);
		if (archived.length > 0) {
			throw new AccessError(
				"An archived person cannot be on a Team Lead's list",
			);
		}
		await db.transaction(async (tx) => {
			await tx
				.delete(teamLeadPerson)
				.where(
					and(
						eq(teamLeadPerson.organizationId, ctx.organizationId),
						eq(teamLeadPerson.leadUserId, input.leadUserId),
					),
				);
			if (personUserIds.length > 0) {
				await tx.insert(teamLeadPerson).values(
					personUserIds.map((personUserId) => ({
						organizationId: ctx.organizationId,
						leadUserId: input.leadUserId,
						personUserId,
					})),
				);
			}
		});
		return teamLeadsService.listPeople(ctx, input.leadUserId);
	},

	/** Drop a person from every Team Lead list in the organization, as lead and
	 *  as person led. Call this when someone leaves — is removed from the
	 *  organization, or is archived — so the rows don't outlive the membership
	 *  that made them valid. Without it, a re-invited lead silently regained
	 *  their old list, and a returning person silently reappeared on one. Not
	 *  itself admin-gated: it runs from inside `membersService.setArchived` and
	 *  the member-removal path, both of which already required Admin to reach
	 *  here. */
	removeFromAllLists: async (ctx: Ctx, userId: string): Promise<void> => {
		await db
			.delete(teamLeadPerson)
			.where(
				and(
					eq(teamLeadPerson.organizationId, ctx.organizationId),
					or(
						eq(teamLeadPerson.leadUserId, userId),
						eq(teamLeadPerson.personUserId, userId),
					),
				),
			);
	},
};
