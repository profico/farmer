import {
	cancelInvitationInput,
	inviteMemberInput,
	memberUserIdInput,
	monthPeriodInput,
	removeMemberInput,
	resendInvitationInput,
	setMemberArchivedInput,
	setMemberStartDateInput,
	setMemberTypeInput,
	updateMemberRoleInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { orgAdminMiddleware, orgMiddleware } from "./auth";

// The People screen (PRD 3.1): everyone with their org role, person type and
// start date. Distinct from `listMembers` below, which is the bare membership
// list (id, role, name, email) and carries no product data.
export const listPeople = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { membersService } = await import("@farmer/core/services");
		return membersService.list(context.ctx);
	});

// Names and photos for everyone in the org — the one source every avatar in the
// app draws from (see `membersService.directory`). Org-scoped, not admin-only:
// a person's face is not a personnel record, and the screens that show one are
// mostly screens a plain member can already open.
export const listDirectory = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { membersService } = await import("@farmer/core/services");
		return membersService.directory(context.ctx);
	});

// Person types resolved as of a given month, which is what every report reads
// — a type change is effective-dated, so "what is Ana" is only
// answerable relative to a month.
export const listMemberTypesForMonth = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(monthPeriodInput)
	.handler(async ({ data, context }) => {
		const { membersService } = await import("@farmer/core/services");
		const types = await membersService.typesForMonth(
			context.ctx,
			data.year,
			data.month,
		);
		// A Map doesn't survive the server-fn JSON boundary.
		return Object.fromEntries(types);
	});

export const getMemberTypeHistory = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.validator(memberUserIdInput)
	.handler(async ({ data: userId, context }) => {
		const { membersService } = await import("@farmer/core/services");
		return membersService.typeHistory(context.ctx, userId);
	});

export const setMemberType = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(setMemberTypeInput)
	.handler(async ({ data, context }) => {
		const { membersService } = await import("@farmer/core/services");
		return membersService.setType(context.ctx, data);
	});

export const setMemberStartDate = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(setMemberStartDateInput)
	.handler(async ({ data, context }) => {
		const { membersService } = await import("@farmer/core/services");
		return membersService.setStartDate(
			context.ctx,
			data.userId,
			data.startDate,
		);
	});

export const setMemberArchived = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(setMemberArchivedInput)
	.handler(async ({ data, context }) => {
		const { membersService } = await import("@farmer/core/services");
		return membersService.setArchived(context.ctx, data.userId, data.archived);
	});

// An active person an import made with an address nobody has confirmed. The
// archived ones are confirmed by `setMemberArchived` on restore.
export const confirmMemberEmail = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(memberUserIdInput)
	.handler(async ({ data: userId, context }) => {
		const { membersService } = await import("@farmer/core/services");
		return membersService.confirmEmail(context.ctx, userId);
	});

export const listMembers = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		// Not `auth.api.listMembers`: it throws in an org over 100 people (see
		// `membersService.roster`).
		const { membersService } = await import("@farmer/core/services");
		return membersService.roster(context.ctx);
	});

export const listInvitations = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const [{ auth }, { membersService }] = await Promise.all([
			import("@farmer/core/auth"),
			import("@farmer/core/services"),
		]);
		const [invitations, emails] = await Promise.all([
			auth.api.listInvitations({
				query: { organizationId: context.ctx.organizationId },
				headers: getRequestHeaders(),
			}),
			membersService.invitationEmails(context.ctx),
		]);
		// Null for an invitation made before delivery was tracked.
		return invitations.map((i) => ({
			...i,
			emailDelivery: emails.get(i.id) ?? null,
		}));
	});

export const inviteMember = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(inviteMemberInput)
	.handler(async ({ data, context }) => {
		const { auth } = await import("@farmer/core/auth");
		return auth.api.createInvitation({
			body: {
				email: data.email,
				role: data.role,
				organizationId: context.ctx.organizationId,
			},
			headers: getRequestHeaders(),
		});
	});

export const cancelInvitation = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(cancelInvitationInput)
	.handler(async ({ data: invitationId }) => {
		const { auth } = await import("@farmer/core/auth");
		return auth.api.cancelInvitation({
			body: { invitationId },
			headers: getRequestHeaders(),
		});
	});

// better-auth's own resend: `createInvitation` with `resend: true` moves the
// expiry forward and runs `sendInvitationEmail` again, which sends both the
// email and the Slack DM. It takes the address rather than the id, so the id is
// resolved first, inside this org.
export const resendInvitation = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(resendInvitationInput)
	.handler(async ({ data: invitationId, context }) => {
		const [{ auth }, { membersService }] = await Promise.all([
			import("@farmer/core/auth"),
			import("@farmer/core/services"),
		]);
		const pending = await membersService.pendingInvitation(
			context.ctx,
			invitationId,
		);
		if (!pending) throw new Error("This invitation is no longer pending.");
		return auth.api.createInvitation({
			body: {
				email: pending.email,
				role: pending.role,
				organizationId: context.ctx.organizationId,
				resend: true,
			},
			headers: getRequestHeaders(),
		});
	});

export const removeMember = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(removeMemberInput)
	.handler(async ({ data: memberIdOrEmail, context }) => {
		const [{ auth }, { membersService, teamLeadsService }] = await Promise.all([
			import("@farmer/core/auth"),
			import("@farmer/core/services"),
		]);
		// Resolved before the removal, since `team_lead_person` is keyed on user
		// id and the membership row (the only thing that maps memberIdOrEmail to
		// it) is gone once `removeMember` succeeds.
		const userId = await membersService.resolveUserId(
			context.ctx,
			memberIdOrEmail,
		);
		const result = await auth.api.removeMember({
			body: { memberIdOrEmail, organizationId: context.ctx.organizationId },
			headers: getRequestHeaders(),
		});
		// A stale list row is what let a re-invited lead silently regain their
		// old people, or a returning person silently reappear on one.
		if (userId) {
			await teamLeadsService.removeFromAllLists(context.ctx, userId);
		}
		return result;
	});

export const updateMemberRole = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(updateMemberRoleInput)
	.handler(async ({ data, context }) => {
		const { auth } = await import("@farmer/core/auth");
		return auth.api.updateMemberRole({
			body: {
				memberId: data.memberId,
				role: data.role,
				organizationId: context.ctx.organizationId,
			},
			headers: getRequestHeaders(),
		});
	});
