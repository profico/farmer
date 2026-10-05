import { isAPIError } from "better-auth/api";
import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "../db";
import { invitation, organization, user } from "../db/schema/auth";
import { isSingleOrgMode } from "../lib/single-org";
import { slugify } from "../lib/slug";
import { UserFacingError } from "../lib/user-facing-error";
import type { CreateOrganizationInput } from "../schema/organization";
import { AccessError } from "../services/access.service";
import { auth } from "./index";
import { mayClaimInvitation } from "./registration";

/**
 * The steps of a person who is not in a workspace yet: the invitations to
 * them, and a workspace of their own. For `/api/v1/me/...`, which the mobile
 * app calls before it has a workspace. The web app does the same on
 * `/no-access`, on `/accept-invite` and in the org switcher.
 *
 * better-auth owns the writes, as in `memberAdmin`: each one goes through its
 * endpoint, so its own checks and its `organizationHooks` run. `headers` must
 * name a session of the caller (`sessionCookieHeader`). An API token has no
 * session, so the route refuses it before it calls this.
 */

/** better-auth's refusal as an error that the REST API may show: 403 for a
 *  refusal of access, 422 for the rest. */
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

export type MyInvitation = {
	id: string;
	role: string | null;
	organizationId: string;
	organizationName: string;
	expiresAt: Date;
};

/** The slug of an organization, for the answer that tells the app where to
 *  go next. */
const slugOf = async (organizationId: string): Promise<string> => {
	const org = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: { slug: true },
	});
	if (!org) throw new Error("Organization not found");
	return org.slug;
};

export const onboarding = {
	/**
	 * The live invitations to the person's address, any case.
	 *
	 * Not better-auth's `listUserInvitations`: that endpoint refuses each
	 * caller whose address is not verified, also in development, where no
	 * password account is verified. The address must be verified all the same
	 * outside development (`mayClaimInvitation`), because an invitation is
	 * matched by the address alone. Accepting refuses the same person.
	 */
	pendingInvitationsFor: async (person: {
		email: string;
		emailVerified: boolean;
	}): Promise<MyInvitation[]> => {
		if (!mayClaimInvitation(person.emailVerified)) return [];
		const email = person.email.toLowerCase();
		return db
			.select({
				id: invitation.id,
				role: invitation.role,
				organizationId: organization.id,
				organizationName: organization.name,
				expiresAt: invitation.expiresAt,
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
	},

	/** `pendingInvitationsFor` for a person named by id, for a caller that
	 *  has no session row in hand (`GET /api/v1/me/invitations`). */
	pendingInvitationsForUser: async (
		userId: string,
	): Promise<MyInvitation[]> => {
		const person = await db.query.user.findFirst({
			where: eq(user.id, userId),
			columns: { email: true, emailVerified: true },
		});
		return person ? onboarding.pendingInvitationsFor(person) : [];
	},

	/** Join through an invitation. The `afterAcceptInvitation` hook writes
	 *  `member.joined`. Returns the workspace to open. */
	acceptInvitation: async (
		headers: Headers,
		invitationId: string,
	): Promise<{ organizationId: string; slug: string }> => {
		const accepted = await viaBetterAuth(() =>
			auth.api.acceptInvitation({ body: { invitationId }, headers }),
		);
		if (!accepted) throw new Error("Invitation not found");
		const organizationId = accepted.invitation.organizationId;
		return { organizationId, slug: await slugOf(organizationId) };
	},

	/** Say no to an invitation. The `afterRejectInvitation` hook writes
	 *  `member.invitation_declined` in the workspace that sent it. */
	rejectInvitation: async (
		headers: Headers,
		invitationId: string,
	): Promise<void> => {
		await viaBetterAuth(() =>
			auth.api.rejectInvitation({ body: { invitationId }, headers }),
		);
	},

	/**
	 * A new workspace, with the caller as its owner. The rules of the org
	 * switcher: the slug comes from the name, and the
	 * `beforeCreateOrganization` hook moves a reserved one. Single-org mode
	 * refuses it here with a sentence. `allowUserToCreateOrganization` in
	 * `./index.ts` refuses it too, for each other way to the endpoint.
	 */
	createOrganization: async (
		headers: Headers,
		input: CreateOrganizationInput,
	): Promise<{ id: string; name: string; slug: string }> => {
		if (isSingleOrgMode()) {
			throw new AccessError(
				"This server has one workspace. Ask its administrator for an invitation.",
			);
		}
		const slug = input.slug ?? slugify(input.name);
		const created = await viaBetterAuth(() =>
			auth.api.createOrganization({
				body: {
					name: input.name,
					slug,
					timezone: input.timezone,
					country: input.country.toUpperCase(),
					weekStartsOn: input.weekStartsOn,
				},
				headers,
			}),
		);
		if (!created) throw new Error("Could not create the workspace");
		return { id: created.id, name: created.name, slug: created.slug };
	},
};
