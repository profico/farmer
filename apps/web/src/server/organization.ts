import {
	setActiveOrgBySlugInput,
	updateOrganizationSettingsInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
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
