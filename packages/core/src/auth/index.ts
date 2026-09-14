import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { genericOAuth, mcp, organization } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import * as schema from "../db/schema/auth";
import { ensureOrgTasks } from "../db/seed-tasks";
import { isDevAuthEnabled } from "../lib/dev-auth";
import { sendMail } from "../lib/email";
import {
	bootstrapSingleOrg,
	findPendingInvitation,
	findSingleOrg,
	isSingleOrgMode,
} from "../lib/single-org";
import { slugify } from "../lib/slug";
import { membersService } from "../services/members.service";
import { slackService } from "../services/slack.service";

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
	// Google is the only identity this app accepts in production, and these
	// endpoints are OFF there — /api/auth/sign-up/email is a public POST whether
	// or not a form points at it, so leaving it enabled would be a second,
	// unreachable-by-design way in.
	//
	// In development it is on, so a fresh checkout can be signed into without a
	// Google Cloud project (see lib/dev-auth.ts for why the gate is NODE_ENV and
	// not an opt-in flag). Everything downstream is shared with the Google path
	// rather than special-cased: the `databaseHooks.user.create` hooks below
	// still bootstrap the org and seed its tasks, and single-org mode's
	// invite-only gate still applies — signing up with a password does not get
	// you past an invitation you don't have.
	emailAndPassword: {
		enabled: isDevAuthEnabled(),
		// No verification flow exists anywhere in this app (see the note on
		// `/no-access`), so requiring it would make every dev account unusable.
		requireEmailVerification: false,
		// One round trip from the form to a session. The whole point is to stop
		// bootstrapping from being a chore.
		autoSignIn: true,
	},
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
			//
			// `repo` is a broad grant — read AND write on every private repository
			// the person can reach — and it is NOT what reads commits. That is the
			// per-org App installation token; this user token never touches repo
			// content, only `GET /user` and `GET /user/installations`.
			//
			// It is kept for exactly one reason, so don't "tidy" it away:
			// `GET /user/installations` is documented as working only for OAuth app
			// and classic tokens that carry `repo`, and that call is the
			// authorization gate in `githubService.connectInstallation` — the check
			// that you may only attach an installation you actually administer.
			// Remove the scope and connecting the GitHub App breaks for everyone who
			// links their account afterwards.
			//
			// (The older note here — "so commit tracking works for private repos" —
			// stopped being true when commit reads moved to the installation token.
			// The scope stayed necessary; the reason changed underneath it.)
			//
			// The way out, if the grant is ever judged too broad, is to stop using a
			// classic OAuth app for GitHub identity and issue a GitHub App *user
			// access token* instead, which enumerates installations without `repo`.
			// That is a provider change, not a one-line scope edit.
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
			//
			// Always show Google's account chooser. Without a login screen there is
			// nowhere else to offer "use a different account", so a browser already
			// signed into Google would otherwise pick one silently and give the
			// visitor no way back — which matters most on an invite-only instance,
			// where the invitation is tied to one specific address.
			prompt: "select_account",
			// Google is the profile of record: `user.name` and `user.image` come
			// from it and this app has no screen that edits either one. The default
			// (false) writes both once, when the user row is created, and never
			// again — so a new photo or a changed surname stayed whatever it was on
			// the day the person first signed in, for as long as the account lived.
			// Sign-in is the only moment Google tells us anything about the person,
			// so it is the only place this can be refreshed.
			//
			// It refreshes `email` too, not just the two display fields (see
			// better-auth's `handleOAuthUserInfo`). That is the right way round
			// here — this provider IS the identity, so the address on the account
			// should be the address they sign in with — but it is worth knowing,
			// because invitations are matched by email: a person whose Google
			// address changes stops matching an invitation addressed to the old
			// one, exactly as they would if they signed in with a different
			// account.
			overrideUserInfoOnSignIn: true,
		},
	},
	databaseHooks: {
		user: {
			create: {
				// Single-org mode's signup gate. It lives here, on user creation,
				// rather than on a screen, because signing in with Google *is* the
				// signup — a first-time Google user is created on the way through the
				// OAuth callback, with no form anywhere in the path. One hook is the
				// only place that covers it.
				before: async (user) => {
					if (!isSingleOrgMode()) return;
					const org = await findSingleOrg();
					// Instance not claimed yet — this signup bootstraps it (see the
					// `after` hook). Deliberately open: whoever reaches a fresh
					// deployment first becomes its owner, so deploy and sign up in the
					// same sitting.
					if (!org) return;
					if (await findPendingInvitation(org.id, user.email)) return;
					// `code` is load-bearing, not decoration: the OAuth callback only
					// converts a thrown APIError into a redirect back to
					// `errorCallbackURL` when one is present (see better-auth's
					// api/routes/callback). Without it this surfaces as a raw 403 in
					// the middle of the Google round-trip instead of the sign-in
					// screen's own message.
					throw new APIError("FORBIDDEN", {
						code: "INVITE_ONLY",
						message:
							"This workspace is invite-only. Sign in with the Google account the invitation was sent to, or ask an admin to invite you.",
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
						// Oldest membership first, so a multi-org user lands in the same
						// workspace on every sign-in. Unordered, "whichever comes back
						// first" is whatever the planner felt like, which meant the same
						// person could open the app in a different org from one login to
						// the next with nothing having changed. Matches how
						// `getDefaultOrgSlugForSession` picks its fallback.
						orderBy: (m, { asc }) => asc(m.createdAt),
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
			// better-auth's default is 100: accepting an invitation or adding a
			// member is refused at 100 members. A Harvest import brings every
			// former employee in as an archived member, so a real org passes 100
			// at once. (Its `listMembers` breaks there too, whatever this says —
			// see `membersService.roster`.)
			membershipLimit: 10_000,
			// Becoming a member of an organization is the moment to match somebody to
			// Slack, and it was previously nobody's job: the only path was an admin
			// pressing "Re-match people" on the integrations screen, so a new hire got
			// no reminder DMs until an admin happened to remember. Nothing tells the
			// person that, and a reminder that silently never arrives is worse than
			// one that does — it looks like the app has nothing to say.
			//
			// Both hooks, because there are two ways to become a member: accepting an
			// invitation (the normal path) and an admin adding somebody directly.
			// Neither can fail on this — `linkMember` swallows its own errors, so a
			// Slack outage or an uninstalled app costs the match, not the membership.
			organizationHooks: {
				afterAcceptInvitation: async ({ member: newMember }) => {
					await slackService.linkMember(
						newMember.organizationId,
						newMember.userId,
					);
				},
				afterAddMember: async ({ member: newMember }) => {
					await slackService.linkMember(
						newMember.organizationId,
						newMember.userId,
					);
				},
			},
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

				const organizationId = data.organization.id;
				const invitationId = data.invitation.id;

				// "sending" is written before this returns, so the members list the
				// dialog refetches already has a row to put a badge on.
				await membersService.recordInvitationEmail(
					organizationId,
					invitationId,
					"sending",
				);

				// The send itself is not awaited. better-auth awaits this hook before
				// `createInvitation` returns, and the invitation row already exists
				// by then — so a slow mail server held the admin's dialog open for as
				// long as it took, over an invitation that had already happened. The
				// outcome lands on `invitationEmail` instead, and the members page
				// shows it; a failed invitation can be cancelled and sent again.
				void sendMail({
					to: data.email,
					subject: `${data.inviter.user.name} invited you to join ${data.organization.name}`,
					text: `${data.inviter.user.name} invited you to join ${data.organization.name} as ${data.role}.\n\nAccept the invitation: ${link}`,
					html: `<p>${data.inviter.user.name} invited you to join <strong>${data.organization.name}</strong> as ${data.role}.</p><p><a href="${link}">Accept the invitation</a></p>`,
				}).then(
					() =>
						membersService.recordInvitationEmail(
							organizationId,
							invitationId,
							"sent",
						),
					(error) => {
						console.error("[auth] invitation email failed", {
							invitationId,
							error,
						});
						return membersService.recordInvitationEmail(
							organizationId,
							invitationId,
							"failed",
							error instanceof Error ? error.message : String(error),
						);
					},
				);

				// And on Slack, when the address is somebody in the org's workspace.
				// Not awaited, for the same reason as the email; `sendInvitation`
				// never throws. It records nothing on `invitationEmail`, since that
				// row is the email's delivery state and a DM is not a fallback for it.
				void slackService.sendInvitation(organizationId, {
					email: data.email,
					inviterName: data.inviter.user.name,
					organizationName: data.organization.name,
					role: data.role,
					path: `${url.pathname}${url.search}`,
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
		// The OAuth authorization server behind `/api/mcp/<orgSlug>`, so an MCP
		// client (Claude Code and friends) can sign a person in and hold a token
		// of its own. It brings dynamic client registration (RFC 7591),
		// `/mcp/authorize`, `/mcp/token`, `getMcpSession` and both discovery
		// documents; the three tables it declares (oauthApplication,
		// oauthAccessToken, oauthConsent) are why `auth.ts` was regenerated.
		//
		// `loginPage` is a dedicated server route, NOT `/login`. The plugin
		// redirects an unauthenticated authorize request to
		// `${loginPage}?${originalQuery}`, carrying eight OAuth parameters that
		// `/login`'s search schema parses none of and Zod therefore strips — so
		// the round trip would come back to `/mcp/authorize` with no client_id
		// and bounce forever. `api/mcp-login.ts` rebuilds the authorize URL from
		// whatever query it was handed and hands it to `/api/login` as a
		// `redirect`, which is a parameter that path already carries safely.
		//
		// No consent screen, deliberately rather than by omission: better-auth
		// only renders one when the client sends `prompt=consent` AND
		// `oidcConfig.consentPage` is set. The person is already consenting twice
		// — once in the Google flow, once in their MCP client's own connection
		// prompt — and a third screen that says the same thing is a screen nobody
		// reads.
		//
		// Mounted whatever `MCP_ENABLED` says; see lib/mcp-flag.ts.
		mcp({ loginPage: "/api/mcp-login" }),
		// tanstackStartCookies MUST stay last — see better-auth/better-auth#5639
		tanstackStartCookies(),
	],
});
