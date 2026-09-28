/**
 * The tenancy decision for a credential that carries no organization.
 *
 * A session cookie in the browser has `activeOrganizationId`; the two other
 * credentials this app accepts do not. An MCP access token resolves to a
 * `userId` and scopes, and a CLI token from the device flow is a session that
 * nobody ever entered a workspace with. Both surfaces therefore put the
 * organization in the URL, and both need the same answer to "may this person
 * speak for that slug". That answer is a domain question rather than a
 * transport one, so it lives here, where `bun test` reaches it and where a
 * future `apps/api` or `apps/mcp` process asks it in the same words.
 *
 * The transport keeps what only it can know: which credential the caller
 * presented, and what an HTTP failure looks like. See `resolveMcpOrgContext`
 * and `resolveCliOrgContext` in `apps/web/src/server/api-auth.ts`.
 */

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "../db";
import { member, organization } from "../db/schema/auth";
import { memberProfile } from "../db/schema/people";
import { NotAMemberError } from "./access.service";
import { ctxAccess } from "./context";
import { membersService } from "./members.service";
import type { Ctx } from "./types";

export const orgContextService = {
	/**
	 * The Ctx for a signed-in person asking about one organization by slug, or
	 * null.
	 *
	 * **Membership is re-checked here and that is the point.** A session's
	 * `activeOrganizationId` outlives the membership that set it, which is why
	 * `orgMiddleware` and `resolveApiOrgContext` re-check; an MCP token or a CLI
	 * token outlives it by much more, because each is a credential that sits in
	 * a config file or a keyring until somebody revokes it. So this is the check
	 * that decides whether the URL still answers, not a formality on the way to
	 * one.
	 *
	 * **A slug nobody owns and a slug the caller is not in are the same answer**
	 * — null, which the route turns into a 401. Deliberate, and the same rule
	 * `enterOrganization` follows: otherwise a valid token is an oracle for
	 * which workspaces exist on the deployment.
	 *
	 * `ctxAccess` runs before returning so the request's memo is warm: the
	 * service calls under it then answer from one resolution instead of
	 * repeating it.
	 */
	resolveBySlug: async (
		userId: string,
		orgSlug: string,
	): Promise<Ctx | null> => {
		const org = await db.query.organization.findFirst({
			where: eq(organization.slug, orgSlug),
		});
		if (!org) return null;

		const role = await membersService.getRole({
			organizationId: org.id,
			userId,
		});
		if (!role) return null;

		const ctx = { organizationId: org.id, userId };
		try {
			await ctxAccess(ctx);
		} catch (error) {
			// Unreachable while `getRole` above answered, but the two are separate
			// reads and this is the one that actually gates the data. Treating a
			// disagreement between them as "no" costs a request; treating it as
			// "yes" hands out a Ctx that nothing else in the process re-checks.
			if (error instanceof NotAMemberError) return null;
			throw error;
		}
		return ctx;
	},

	/**
	 * The organizations a person is a member of, oldest membership first.
	 *
	 * What `farmer login` offers after the device flow, when the token has no
	 * organization yet, and what the web app's workspace chooser lists. Oldest
	 * first for the reason the session hook in `auth/index.ts` orders that way:
	 * the same person gets the same default every time, rather than whichever
	 * row the planner returned first.
	 *
	 * A membership with a pending claim is left out: it is not the person's
	 * workspace until they accept it (`importClaimsService`), so no chooser, no
	 * switcher and no `farmer login` offers it.
	 */
	organizationsFor: async (
		userId: string,
	): Promise<
		{
			slug: string;
			name: string;
			logo: string | null;
			role: string;
			timezone: string;
		}[]
	> =>
		db
			.select({
				slug: organization.slug,
				name: organization.name,
				logo: organization.logo,
				role: member.role,
				timezone: organization.timezone,
			})
			.from(member)
			.innerJoin(organization, eq(member.organizationId, organization.id))
			.leftJoin(
				memberProfile,
				and(
					eq(memberProfile.organizationId, member.organizationId),
					eq(memberProfile.userId, member.userId),
				),
			)
			.where(
				and(eq(member.userId, userId), isNull(memberProfile.claimPendingSince)),
			)
			.orderBy(asc(member.createdAt)),

	/** The slug and name of the Ctx's own organization. A Ctx is only ever
	 *  built for an organization that exists, so a missing row is a bug. */
	organizationOf: async (ctx: Ctx): Promise<{ slug: string; name: string }> => {
		const org = await db.query.organization.findFirst({
			where: eq(organization.id, ctx.organizationId),
		});
		if (!org) throw new Error("Organization not found");
		return { slug: org.slug, name: org.name };
	},
};
