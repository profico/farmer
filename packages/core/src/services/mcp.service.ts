/**
 * The MCP server's tenancy decision.
 *
 * One function, and it is here rather than in the web route for the reason
 * every service is: an MCP access token resolves to a `userId` and scopes, so
 * turning that plus a slug into a `Ctx` is a domain question, not a transport
 * one — and a future `apps/mcp` process asks it with the same words.
 *
 * The transport keeps what only it can know: which credential the caller
 * presented, and what an HTTP failure looks like. See `resolveMcpOrgContext` in
 * `apps/web/src/server/api-auth.ts`.
 */

import { eq } from "drizzle-orm";

import { db } from "../db";
import { organization } from "../db/schema/auth";
import { NotAMemberError } from "./access.service";
import { ctxAccess } from "./context";
import { membersService } from "./members.service";
import type { Ctx } from "./types";

export const mcpService = {
	/**
	 * The Ctx for a signed-in person asking about one organization by slug, or
	 * null.
	 *
	 * **Membership is re-checked here and that is the point.** A session's
	 * `activeOrganizationId` outlives the membership that set it, which is why
	 * `orgMiddleware` and `resolveApiOrgContext` re-check; an MCP token outlives
	 * it by much more, because it is a credential a client keeps in a config
	 * file until somebody revokes it. So this is the check that decides whether
	 * the URL still answers, not a formality on the way to one.
	 *
	 * **A slug nobody owns and a slug the caller is not in are the same answer**
	 * — null, which the route turns into a 401. Deliberate, and the same rule
	 * `enterOrganization` follows: otherwise a valid token is an oracle for
	 * which workspaces exist on the deployment.
	 *
	 * `ctxAccess` runs before returning so the request's memo is warm: the tool
	 * list and every tool call under it then answer from one resolution instead
	 * of repeating it.
	 */
	resolveOrgContext: async (
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
};
