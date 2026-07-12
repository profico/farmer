import {
	cancelInvitationInput,
	inviteMemberInput,
	removeMemberInput,
	updateMemberRoleInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { orgAdminMiddleware, orgMiddleware } from "./auth";

export const listMembers = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { auth } = await import("@farmer/core/auth");
		return auth.api.listMembers({
			query: { organizationId: context.ctx.organizationId },
			headers: getRequestHeaders(),
		});
	});

export const listInvitations = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { auth } = await import("@farmer/core/auth");
		return auth.api.listInvitations({
			query: { organizationId: context.ctx.organizationId },
			headers: getRequestHeaders(),
		});
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

export const removeMember = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(removeMemberInput)
	.handler(async ({ data: memberIdOrEmail, context }) => {
		const { auth } = await import("@farmer/core/auth");
		return auth.api.removeMember({
			body: { memberIdOrEmail, organizationId: context.ctx.organizationId },
			headers: getRequestHeaders(),
		});
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
