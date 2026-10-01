// A Harvest import's pending claims, from the side of the PERSON they name.
//
// In multi-org mode the import creates a `user` and a `member` row for a
// person whose address had no account yet — usually a former employee. When the
// real owner of that address signs in later, better-auth links the sign-in to
// that user row, so without this they were simply a member of the importing
// organization and nobody had asked them. The import marks such a membership
// with `memberProfile.claimPendingSince` instead: the organization sees the
// person as before (People, reports, the archived former employees), and the
// person cannot open the organization until they accept here.
//
// Every refusal of a pending claim comes from one fact, read in three places:
// `accessService.resolve` (the web middleware, the REST and CLI API, MCP),
// `membersService.getRole` (the workspace guard) and the lists that offer a
// workspace (`orgContextService.organizationsFor`, the session hook in
// `auth/index.ts`). Reminders read it in `deliveryBlocks` (notify.ts).
//
// Not org-scoped in the usual sense: the caller is acting on their own
// membership, so `ctx.userId` is always the signed-in person and
// `ctx.organizationId` the organization whose claim they answer. No `Access`
// is resolved, because `resolve` refuses exactly these callers.

import { and, asc, eq, isNotNull } from "drizzle-orm";

import { type DbClient, db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { memberProfile } from "../db/schema/people";
import { UserFacingError } from "../lib/user-facing-error";
import { recordAudit } from "./audit";
import { memberJoined } from "./member-joined";
import { teamLeadsService } from "./team-leads.service";
import type { Ctx } from "./types";

/** The caller has no pending claim in the organization they named. The same
 *  answer for "no such organization", so this is not a way to probe which
 *  organizations exist. */
export class NoPendingClaimError extends UserFacingError {
	constructor() {
		super("There is no imported history waiting for you in this workspace");
		this.name = "NoPendingClaimError";
	}
}

export type PendingClaim = {
	organizationId: string;
	name: string;
	slug: string;
	logo: string | null;
	/** When the import made the membership. */
	since: Date;
};

/** The caller's membership in `ctx.organizationId`, while its claim is still
 *  pending; throws `NoPendingClaimError` otherwise. `client` is the
 *  transaction, so the answer holds for the write that follows it. */
const pendingMembership = async (
	client: DbClient,
	ctx: Ctx,
): Promise<{ role: string; name: string }> => {
	const [row] = await client
		.select({ role: member.role, name: user.name })
		.from(memberProfile)
		.innerJoin(
			member,
			and(
				eq(member.organizationId, memberProfile.organizationId),
				eq(member.userId, memberProfile.userId),
			),
		)
		.innerJoin(user, eq(user.id, memberProfile.userId))
		.where(
			and(
				eq(memberProfile.organizationId, ctx.organizationId),
				eq(memberProfile.userId, ctx.userId),
				isNotNull(memberProfile.claimPendingSince),
			),
		)
		.limit(1)
		.for("update");
	if (!row) throw new NoPendingClaimError();
	return row;
};

const clearClaim = (client: DbClient, ctx: Ctx) =>
	client
		.update(memberProfile)
		.set({ claimPendingSince: null, updatedAt: new Date() })
		.where(
			and(
				eq(memberProfile.organizationId, ctx.organizationId),
				eq(memberProfile.userId, ctx.userId),
			),
		);

export const importClaimsService = {
	/** The organizations that imported the caller's history and wait for an
	 *  answer, oldest first. What `/no-access` offers. */
	pendingFor: async (userId: string): Promise<PendingClaim[]> => {
		const rows = await db
			.select({
				organizationId: organization.id,
				name: organization.name,
				slug: organization.slug,
				logo: organization.logo,
				since: memberProfile.claimPendingSince,
			})
			.from(memberProfile)
			.innerJoin(
				member,
				and(
					eq(member.organizationId, memberProfile.organizationId),
					eq(member.userId, memberProfile.userId),
				),
			)
			.innerJoin(
				organization,
				eq(organization.id, memberProfile.organizationId),
			)
			.where(
				and(
					eq(memberProfile.userId, userId),
					isNotNull(memberProfile.claimPendingSince),
				),
			)
			.orderBy(asc(memberProfile.claimPendingSince));
		// The `where` above keeps only rows with a date; the column type does
		// not know that, so the rows are narrowed rather than asserted.
		return rows.flatMap(({ since, ...rest }) =>
			since ? [{ ...rest, since }] : [],
		);
	},

	/** Join: the membership the import made becomes the caller's own. Runs
	 *  what joining runs on every other path (`memberJoined`: `member.joined`
	 *  in the audit log, the Slack match and `member.added`), after the write
	 *  has committed. Returns the slug to enter. */
	accept: async (ctx: Ctx): Promise<{ slug: string }> => {
		const { role, name } = await db.transaction(async (tx) => {
			const pending = await pendingMembership(tx, ctx);
			await clearClaim(tx, ctx);
			return pending;
		});
		await memberJoined(
			ctx,
			{ organizationId: ctx.organizationId, userId: ctx.userId, role },
			name,
		);
		const org = await db.query.organization.findFirst({
			where: eq(organization.id, ctx.organizationId),
			columns: { slug: true },
		});
		if (!org) throw new NoPendingClaimError();
		return { slug: org.slug };
	},

	/** Decline: the caller leaves the organization. Only the `member` row
	 *  goes. The profile, the time entries and the assignments stay, because
	 *  they are the organization's history of the person and not the person's
	 *  account. The team lead lists go too, as they do when an admin removes
	 *  somebody (`removeMember` in `apps/web/src/server/members.ts`), so a
	 *  later invitation does not bring an old list back in silence. The
	 *  audit log records the decline as `member.claim_declined`. */
	decline: async (ctx: Ctx): Promise<void> => {
		const { role, name } = await db.transaction(async (tx) => {
			const pending = await pendingMembership(tx, ctx);
			await tx
				.delete(member)
				.where(
					and(
						eq(member.organizationId, ctx.organizationId),
						eq(member.userId, ctx.userId),
					),
				);
			await clearClaim(tx, ctx);
			return pending;
		});
		// After the commit: this transaction is a raw `db.transaction`, and a
		// second connection held inside it is the deadlock `ctxDb` warns about.
		await recordAudit(ctx, {
			kind: "member.claim_declined",
			subjectUserId: ctx.userId,
			target: { type: "member", id: ctx.userId, label: name },
			details: { role },
		});
		await teamLeadsService.removeFromAllLists(ctx, ctx.userId);
	},
};
