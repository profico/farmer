import { and, eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { genericOAuth, organization } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "../db";
import * as schema from "../db/schema/auth";
import { ensureOrgTasks } from "../db/seed-tasks";
import { sendMail } from "../lib/email";
import {
	bootstrapSingleOrg,
	findPendingInvitation,
	findSingleOrg,
	isSingleOrgMode,
} from "../lib/single-org";
import { slugify } from "../lib/slug";

const uniqueSlugFor = async (name: string) => {
	const base = slugify(name);
	let slug = base;
	let suffix = 1;
	while (
		await db.query.organization.findFirst({
			where: eq(schema.organization.slug, slug),
		})
	) {
		slug = `${base}-${suffix++}`;
	}
	return slug;
};

export const auth = betterAuth({
	database: drizzleAdapter(db, { provider: "pg", schema }),
	emailAndPassword: { enabled: true },
	session: {
		// better-auth guards unlink-account / session-management behind a "fresh
		// session" check (freshSessionMiddleware) that 403s SESSION_NOT_FRESH once
		// the session is older than freshAge (default 1 day). We have no step-up
		// re-auth flow, so a day-old session could never disconnect an integration.
		// Disconnecting GitHub/Google is not an identity-sensitive op, so drop the
		// freshness requirement entirely (0 = skip the check).
		freshAge: 0,
	},
	account: {
		accountLinking: {
			// GitHub only returns emailVerified:true for the user's primary
			// verified email; without this, linking a github account to an
			// existing email/password user fails with "untrusted provider"
			// whenever that check doesn't hold. Google is here for the same
			// reason — the linked Google account's email needn't match the app's.
			// "google-calendar" is the genericOAuth provider used only to link the
			// per-user calendar grant (see the genericOAuth plugin below); the base
			// "google" provider is identity-only, for Sign in with Google.
			trustedProviders: ["github", "google", "google-calendar"],
			// These flows only connect an external account to enrich an already
			// logged-in user (GitHub commits, Google Calendar meetings) — they're
			// not sign-in identity checks — so the linked account's email has no
			// reason to match the app account's.
			allowDifferentEmails: true,
		},
	},
	socialProviders: {
		github: {
			clientId: process.env.GITHUB_CLIENT_ID!,
			clientSecret: process.env.GITHUB_CLIENT_SECRET!,
			// Appended to better-auth's default ["read:user","user:email"].
			// Classic OAuth has no read-only-private-repos scope — `repo` is
			// needed so commit tracking works for private repos too.
			scope: ["repo"],
		},
		google: {
			clientId: process.env.GOOGLE_CLIENT_ID!,
			clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
			// Identity only (default openid/email/profile) — this is the "Sign in
			// with Google" provider. The calendar grant is intentionally NOT here:
			// it lives in the separate "google-calendar" genericOAuth provider
			// (below) so logging in never demands calendar access or forces the
			// consent screen, and so a plain login row can't be mistaken for a
			// live calendar connection.
		},
	},
	databaseHooks: {
		user: {
			create: {
				// Single-org mode's signup gate. It lives here, on user creation,
				// rather than on the register screen, because the screen is not the
				// only way in: a direct POST to /api/auth/sign-up/email and "Sign in
				// with Google" (which creates a user on first use) both land here and
				// nowhere near the form. One hook covers every provider.
				before: async (user) => {
					if (!isSingleOrgMode()) return;
					const org = await findSingleOrg();
					// Instance not claimed yet — this signup bootstraps it (see the
					// `after` hook). Deliberately open: whoever reaches a fresh
					// deployment first becomes its owner, so deploy and sign up in the
					// same sitting.
					if (!org) return;
					if (await findPendingInvitation(org.id, user.email)) return;
					throw new APIError("FORBIDDEN", {
						message:
							"This workspace is invite-only. Ask an admin to send you an invitation.",
					});
				},
				after: async (user) => {
					if (isSingleOrgMode()) {
						// Either this call claims the instance, or the user was invited
						// and their membership comes from accepting the invitation — not
						// from signing up. Never a second organization.
						await bootstrapSingleOrg(user.id);
						return;
					}
					const organizationId = crypto.randomUUID();
					await db.insert(schema.organization).values({
						id: organizationId,
						name: `${user.name}'s Workspace`,
						slug: await uniqueSlugFor(user.name),
						timezone: "UTC",
						country: "US",
						createdAt: new Date(),
					});
					await db.insert(schema.member).values({
						id: crypto.randomUUID(),
						organizationId,
						userId: user.id,
						role: "owner",
						createdAt: new Date(),
					});
					// Seed the starter taxonomy here rather than leaving it to the dev
					// seed script: a brand-new org with no tasks cannot log a single
					// entry, and the calendar-sync and day-assembly engines have nothing
					// to resolve, both of which fail silently.
					await ensureOrgTasks(organizationId);
				},
			},
		},
		session: {
			create: {
				before: async (session) => {
					// In single-org mode, pin the session to *the* organization rather
					// than to whichever membership happens to come back first. Only
					// matters for a database that had several organizations before the
					// mode was switched on — but that's exactly when picking the wrong
					// one would be hardest to notice.
					const singleOrg = isSingleOrgMode() ? await findSingleOrg() : null;
					const membership = await db.query.member.findFirst({
						where: singleOrg
							? and(
									eq(schema.member.userId, session.userId),
									eq(schema.member.organizationId, singleOrg.id),
								)
							: eq(schema.member.userId, session.userId),
					});
					if (!membership) return;
					return { data: { activeOrganizationId: membership.organizationId } };
				},
			},
		},
	},
	// tanstackStartCookies MUST be last — see better-auth/better-auth#5639
	plugins: [
		organization({
			// The API-level half of single-org mode. Hiding the "New organization"
			// item in the switcher is cosmetic; these two are what actually make a
			// second organization (or the loss of the only one) impossible, however
			// the endpoint is reached.
			allowUserToCreateOrganization: !isSingleOrgMode(),
			disableOrganizationDeletion: isSingleOrgMode(),
			schema: {
				organization: {
					additionalFields: {
						timezone: {
							type: "string",
							required: true,
							defaultValue: "UTC",
						},
						country: {
							type: "string",
							required: true,
							defaultValue: "US",
						},
					},
				},
			},
			sendInvitationEmail: async (data) => {
				const url = new URL(
					`/accept-invite/${data.invitation.id}`,
					process.env.BETTER_AUTH_URL,
				);
				url.searchParams.set("email", data.email);
				url.searchParams.set("org", data.organization.name);
				url.searchParams.set("orgSlug", data.organization.slug);
				url.searchParams.set("role", data.role);
				const link = url.toString();

				await sendMail({
					to: data.email,
					subject: `${data.inviter.user.name} invited you to join ${data.organization.name}`,
					text: `${data.inviter.user.name} invited you to join ${data.organization.name} as ${data.role}.\n\nAccept the invitation: ${link}`,
					html: `<p>${data.inviter.user.name} invited you to join <strong>${data.organization.name}</strong> as ${data.role}.</p><p><a href="${link}">Accept the invitation</a></p>`,
				});
			},
		}),
		// The calendar integration's OAuth grant. Same Google OAuth app as the
		// login provider, but a distinct providerId so its account row (and thus
		// getAccessToken / connectionStatus in google-calendar.service.ts) is
		// independent of Sign in with Google. Users link it from Settings →
		// Integrations via authClient.oauth2.link({ providerId: "google-calendar" }).
		genericOAuth({
			config: [
				{
					providerId: "google-calendar",
					discoveryUrl:
						"https://accounts.google.com/.well-known/openid-configuration",
					clientId: process.env.GOOGLE_CLIENT_ID!,
					clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
					pkce: true,
					// genericOAuth does not add better-auth's default identity scopes,
					// so request them explicitly alongside calendar.events (read+write:
					// read meetings for the picker/auto-sync, write all-day events when
					// approved time off is synced). Google has no insert-only scope.
					scopes: [
						"openid",
						"email",
						"profile",
						"https://www.googleapis.com/auth/calendar.events",
					],
					// Google only returns a refresh token when offline access is
					// requested AND consent is re-prompted; without both, the ~1h access
					// token can't be refreshed server-side and reads break after expiry.
					accessType: "offline",
					prompt: "consent",
				},
			],
		}),
		// tanstackStartCookies MUST stay last — see better-auth/better-auth#5639
		tanstackStartCookies(),
	],
});
