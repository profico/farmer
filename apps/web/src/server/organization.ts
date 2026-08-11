import {
	setActiveOrgBySlugInput,
	updateOrganizationSettingsInput,
	updateOrgSettingsInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, eq, gt, sql } from "drizzle-orm";
import { orgAdminMiddleware, sessionMiddleware } from "./auth";

export const setActiveOrgBySlug = createServerFn({ method: "POST" })
	.validator(setActiveOrgBySlugInput)
	.handler(async ({ data: slug }) => {
		const { auth } = await import("@farmer/core/auth");
		try {
			return await auth.api.setActiveOrganization({
				body: { organizationSlug: slug },
				headers: getRequestHeaders(),
			});
		} catch {
			return null;
		}
	});

// No client input: userId and activeOrganizationId are both derived from the
// authenticated session, never trusted from the caller.
export const getDefaultOrgSlugForSession = createServerFn({
	method: "GET",
})
	.middleware([sessionMiddleware])
	.handler(async ({ context }) => {
		const userId = context.session.user.id;
		const activeOrganizationId = context.session.session.activeOrganizationId;

		const { db } = await import("@farmer/core/db");
		const { member, organization } = await import("@farmer/core/schema/auth");

		if (activeOrganizationId) {
			const org = await db.query.organization.findFirst({
				where: eq(organization.id, activeOrganizationId),
			});
			if (org) return org.slug;
		}
		const membership = await db.query.member.findFirst({
			where: eq(member.userId, userId),
			orderBy: (m, { asc }) => asc(m.createdAt),
		});
		if (!membership) return null;
		const org = await db.query.organization.findFirst({
			where: eq(organization.id, membership.organizationId),
		});
		return org?.slug ?? null;
	});

// Live invitations addressed to the caller, for the no-access dead end.
//
// Not better-auth's own `listUserInvitations`: that endpoint rejects any caller
// whose email isn't verified — unconditionally, unlike `acceptInvitation`,
// which only checks when `requireEmailVerificationOnInvitation` is set. This
// app has no verification flow, so every password user would get a 403 on the
// one screen whose entire job is to show them their way in.
export const listMyPendingInvitations = createServerFn({ method: "GET" })
	.middleware([sessionMiddleware])
	.handler(async ({ context }) => {
		const email = context.session.user.email.toLowerCase();
		const { db } = await import("@farmer/core/db");
		const { invitation, organization } = await import(
			"@farmer/core/schema/auth"
		);
		return db
			.select({
				id: invitation.id,
				role: invitation.role,
				organizationName: organization.name,
			})
			.from(invitation)
			.innerJoin(organization, eq(organization.id, invitation.organizationId))
			.where(
				and(
					sql`lower(${invitation.email}) = ${email}`,
					eq(invitation.status, "pending"),
					gt(invitation.expiresAt, new Date()),
				),
			);
	});

export const getOrgSettings = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { organizationService } = await import("@farmer/core/services");
		return organizationService.getSettings(context.ctx);
	});

export const updateOrgSettings = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(updateOrganizationSettingsInput)
	.handler(async ({ data, context }) => {
		const { organizationService } = await import("@farmer/core/services");
		return organizationService.updateSettings(context.ctx, data);
	});

// Distinct from the block above: `organization` is better-auth's row (name,
// timezone, logo), `orgSettings` is this product's own per-org config.
export const getOrgPolicySettings = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { orgSettingsService } = await import("@farmer/core/services");
		return orgSettingsService.get(context.ctx);
	});

export const updateOrgPolicySettings = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(updateOrgSettingsInput)
	.handler(async ({ data, context }) => {
		const { orgSettingsService } = await import("@farmer/core/services");
		return orgSettingsService.update(context.ctx, data);
	});
