import {
	setActiveOrgBySlugInput,
	updateOrganizationSettingsInput,
	updateOrgSettingsInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, eq, gt, sql } from "drizzle-orm";

import { isOrgPlaceholder } from "#/lib/org-redirect.ts";

import {
	optionalSessionMiddleware,
	orgAdminMiddleware,
	sessionMiddleware,
} from "./auth";

/**
 * Everything `/$orgSlug`'s `beforeLoad` needs about the workspace being
 * entered, in one round trip: the session, the organization, and the caller's
 * role in it.
 *
 * It replaces three sequential server-function calls — `requireSession()`, then
 * `setActiveOrgBySlug()`, then `getMyRole()` — and `beforeLoad` runs on every
 * client-side navigation into any org route, so those were three round trips
 * deep on every link click, before a loader had started.
 *
 * The second of them was also a WRITE. `setActiveOrganization` updates the
 * session row, and it ran on every navigation even when the session already
 * named this organization, which is the overwhelmingly common case — the org
 * only actually changes when somebody switches workspace. So the check is now
 * conditional: the write happens when the active org differs, and a plain
 * navigation inside one workspace does no writes at all.
 *
 * When the slug does not open a workspace, the answer says where to go
 * instead, and `beforeLoad` turns that into the redirect:
 *
 *  - `signed-out` — to `/login`, carrying the page that was asked for. The
 *    guard builds that redirect because only it knows the page.
 *  - `elsewhere` — the slug is a placeholder (`/:org/settings`, see
 *    `lib/org-redirect.ts`), names no organization, or names one the caller is
 *    not in. The last two are deliberately the same answer, so this cannot be
 *    used to probe which slugs are taken. `onlySlug` is set when the caller
 *    has exactly one workspace, so the guard can resolve a placeholder
 *    straight to it; otherwise the guard sends them to the chooser, and with
 *    no workspace to `/no-access`. In single-org mode the answer is always
 *    "no workspace".
 */
export const enterOrganization = createServerFn({ method: "POST" })
	.middleware([optionalSessionMiddleware])
	.validator(setActiveOrgBySlugInput)
	.handler(async ({ data: slug, context }) => {
		const { session } = context;
		if (!session) return { kind: "signed-out" } as const;

		const { auth } = await import("@farmer/core/auth");
		const { db } = await import("@farmer/core/db");
		const { organization } = await import("@farmer/core/schema/auth");
		const { membersService, orgContextService } =
			await import("@farmer/core/services");
		const { toWeekStartsOn } = await import("@farmer/core/lib/time");
		const { isPlatformAdminRole } =
			await import("@farmer/core/lib/platform-admin");

		const { isSingleOrgMode } = await import("@farmer/core/lib/single-org");

		const elsewhere = async () => {
			// A one-workspace instance has nowhere else to send anybody. The guard
			// answers every other slug with the one workspace, so an `onlySlug`
			// naming a second organization (a database that had several before the
			// mode was switched on) sent the reader there and straight back again,
			// forever. A non-member here is `/no-access`, whatever else they are in.
			if (isSingleOrgMode()) {
				return { kind: "elsewhere", count: 0, onlySlug: null } as const;
			}
			const organizations = await orgContextService.organizationsFor(
				session.user.id,
			);
			return {
				kind: "elsewhere",
				count: organizations.length,
				onlySlug:
					organizations.length === 1 ? (organizations[0]?.slug ?? null) : null,
			} as const;
		};

		if (isOrgPlaceholder(slug)) return elsewhere();

		const org = await db.query.organization.findFirst({
			where: eq(organization.slug, slug),
		});
		if (!org) return elsewhere();

		// Membership before anything else: this is what decides whether the
		// session may be repointed at this organization at all, and it is the
		// same question `orgMiddleware` asks on every server function underneath.
		const role = await membersService.getRole({
			organizationId: org.id,
			userId: session.user.id,
		});
		if (!role) return elsewhere();

		if (session.session.activeOrganizationId !== org.id) {
			await auth.api.setActiveOrganization({
				body: { organizationId: org.id },
				headers: getRequestHeaders(),
			});
		}

		return {
			kind: "entered",
			session,
			// The column is a plain integer; every week on screen reads this one.
			organization: { ...org, weekStartsOn: toWeekStartsOn(org.weekStartsOn) },
			role,
			// Whether this person operates the DEPLOYMENT, which is a different
			// question from `role` above and a different column — see
			// `packages/core/src/lib/platform-admin.ts`. Resolved here rather than
			// read off the session in the browser so the role string stays on the
			// server, and so the flag arrives with the rest of the shell's context
			// instead of a frame later.
			//
			// It gates a button and nothing more: better-auth refuses the
			// impersonation endpoint itself to anybody without the role, whatever
			// the client believes.
			isPlatformAdmin: isPlatformAdminRole(session.user.role),
			// The person being impersonated right now, or null. `impersonatedBy`
			// holds the OPERATOR's user id, so its presence is the signal and
			// `user.name` — the account the session currently is — is what the
			// sidebar shows.
			impersonating: session.session.impersonatedBy ? session.user.name : null,
		} as const;
	});

/**
 * Every workspace the caller belongs to, for `/choose-organization`. Null when
 * signed out, so the route can send them to `/login` with the page they asked
 * for rather than lose it.
 */
export const listMyOrganizations = createServerFn({ method: "GET" })
	.middleware([optionalSessionMiddleware])
	.handler(async ({ context }) => {
		if (!context.session) return null;
		const { orgContextService } = await import("@farmer/core/services");
		return {
			email: context.session.user.email,
			organizations: await orgContextService.organizationsFor(
				context.session.user.id,
			),
		};
	});

// No client input: userId and activeOrganizationId are both derived from the
// authenticated session, never trusted from the caller.
//
// `activeOrganizationId` is a POINTER, not a permission. It is stamped onto the
// session when a workspace is entered and never revisited, so it outlives the
// membership that set it — which is the same thing `orgMiddleware` and
// `resolveApiOrgContext` re-check membership at the boundary for. Resolving the
// slug from it alone sent somebody who had been removed from the org straight
// back at it, to be turned away by the layout's own guard: a redirect into a
// dead end rather than to the workspace they do still belong to. So the active
// org only answers while the membership behind it is still there, and a stale
// pointer falls through to the oldest one that is.
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
			const [active] = await db
				.select({ slug: organization.slug })
				.from(organization)
				.innerJoin(
					member,
					and(
						eq(member.organizationId, organization.id),
						eq(member.userId, userId),
					),
				)
				.where(eq(organization.id, activeOrganizationId))
				.limit(1);
			if (active) return active.slug;
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
		const { invitation, organization } =
			await import("@farmer/core/schema/auth");
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
