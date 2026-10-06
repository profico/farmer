import { isAPIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { member } from "../db/schema/auth";
import { UserFacingError } from "../lib/user-facing-error";
import type { InviteMemberInput, SetMemberRoleInput } from "../schema/members";
import { AccessError } from "../services/access.service";
import { requireAdmin } from "../services/context";
import { membersService } from "../services/members.service";
import { teamLeadsService } from "../services/team-leads.service";
import type { Ctx } from "../services/types";
import { auth } from "./index";

/**
 * Member management for the REST API: invite, resend, cancel, change a role
 * and remove a person.
 *
 * better-auth owns these writes. Each one goes through its endpoint, so its
 * own permission check runs, and its `organizationHooks` write the audit row
 * and send the invitation email (see `organization()` in `./index.ts`). Never
 * write these rows here: a second writer has a second idea of who may write.
 *
 * `headers` must name a session of the caller: the browser's own headers, or
 * a cookie from `sessionCookieHeader`. A REST route passes a function that
 * makes them (`ApiCaller.sessionHeaders`), because an API token has no
 * session and that function refuses it. Each function here calls it only
 * after its own checks, so a caller who is not an admin hears that, and
 * not that an API token cannot do this.
 *
 * Each function checks the admin role first, the same check as
 * `orgAdminMiddleware` in the web app. The self and owner checks are the ones
 * that the People page makes in the browser (it hides the controls), made
 * here because a REST caller has no page.
 */

/** Runs a better-auth call, and turns its refusal into an error that the
 *  REST API may show: 403 for a refusal of access, 422 for the rest. Its
 *  messages are fixed sentences such as "User is already a member of this
 *  organization". */
const viaBetterAuth = async <T>(call: () => Promise<T>): Promise<T> => {
	try {
		return await call();
	} catch (error) {
		if (isAPIError(error)) {
			if (error.statusCode === 401 || error.statusCode === 403) {
				throw new AccessError(error.message);
			}
			throw new UserFacingError(error.message);
		}
		throw error;
	}
};

/** The membership row of `userId` in the caller's organization. */
const membershipOf = async (ctx: Ctx, userId: string) => {
	const row = await db.query.member.findFirst({
		where: and(
			eq(member.organizationId, ctx.organizationId),
			eq(member.userId, userId),
		),
		columns: { id: true, role: true },
	});
	if (!row) throw new Error("Person not found");
	return row;
};

/** The caller's session headers, or a function that makes them (and can
 *  refuse an API token). */
export type SessionHeaders = Headers | (() => Promise<Headers>);

const headersOf = async (source: SessionHeaders): Promise<Headers> =>
	source instanceof Headers ? source : source();

export const memberAdmin = {
	invite: async (
		ctx: Ctx,
		sessionHeaders: SessionHeaders,
		input: InviteMemberInput,
	) => {
		await requireAdmin(ctx);
		const headers = await headersOf(sessionHeaders);
		return viaBetterAuth(() =>
			auth.api.createInvitation({
				body: {
					email: input.email,
					role: input.role,
					organizationId: ctx.organizationId,
				},
				headers,
			}),
		);
	},

	/** better-auth's own resend: `createInvitation` with `resend: true` moves
	 *  the expiry forward and sends the email and the Slack message again. It
	 *  takes the address, so the id is resolved first, inside this org. */
	resend: async (
		ctx: Ctx,
		sessionHeaders: SessionHeaders,
		invitationId: string,
	) => {
		await requireAdmin(ctx);
		const pending = await membersService.pendingInvitation(ctx, invitationId);
		if (!pending) throw new Error("Invitation not found");
		const headers = await headersOf(sessionHeaders);
		return viaBetterAuth(() =>
			auth.api.createInvitation({
				body: {
					email: pending.email,
					role: pending.role,
					organizationId: ctx.organizationId,
					resend: true,
				},
				headers,
			}),
		);
	},

	/** Only a pending invitation of this org. An id from another org is the
	 *  same 404 as an id that does not exist. */
	cancel: async (
		ctx: Ctx,
		sessionHeaders: SessionHeaders,
		invitationId: string,
	) => {
		await requireAdmin(ctx);
		const pending = await membersService.pendingInvitation(ctx, invitationId);
		if (!pending) throw new Error("Invitation not found");
		const headers = await headersOf(sessionHeaders);
		await viaBetterAuth(() =>
			auth.api.cancelInvitation({ body: { invitationId }, headers }),
		);
	},

	setRole: async (
		ctx: Ctx,
		sessionHeaders: SessionHeaders,
		input: SetMemberRoleInput,
	) => {
		await requireAdmin(ctx);
		if (input.userId === ctx.userId) {
			throw new AccessError("You cannot change your own role");
		}
		const target = await membershipOf(ctx, input.userId);
		if (target.role === "owner") {
			throw new AccessError("You cannot change the owner's role");
		}
		const headers = await headersOf(sessionHeaders);
		await viaBetterAuth(() =>
			auth.api.updateMemberRole({
				body: {
					memberId: target.id,
					role: input.role,
					organizationId: ctx.organizationId,
				},
				headers,
			}),
		);
	},

	/** Removes the membership, then the person's rows on every team lead
	 *  list. A stale list row let a person who came back reappear on a list,
	 *  or a lead regain their old people. */
	remove: async (ctx: Ctx, sessionHeaders: SessionHeaders, userId: string) => {
		await requireAdmin(ctx);
		if (userId === ctx.userId) {
			throw new AccessError("You cannot remove yourself");
		}
		const target = await membershipOf(ctx, userId);
		if (target.role === "owner") {
			const owners = await db.query.member.findMany({
				where: and(
					eq(member.organizationId, ctx.organizationId),
					eq(member.role, "owner"),
				),
				columns: { id: true },
			});
			if (owners.length <= 1) {
				throw new AccessError("You cannot remove the only owner");
			}
		}
		const headers = await headersOf(sessionHeaders);
		await viaBetterAuth(() =>
			auth.api.removeMember({
				body: {
					memberIdOrEmail: target.id,
					organizationId: ctx.organizationId,
				},
				headers,
			}),
		);
		await teamLeadsService.removeFromAllLists(ctx, userId);
	},
};
