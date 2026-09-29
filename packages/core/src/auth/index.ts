import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
	APIError,
	createAuthMiddleware,
	getSessionFromCtx,
	isAPIError,
} from "better-auth/api";
import { getOAuth2Tokens, refreshAccessTokenRequest } from "better-auth/oauth2";
import {
	admin,
	deviceAuthorization,
	type GenericOAuthConfig,
	genericOAuth,
	mcp,
	organization,
} from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { CLI_CLIENT_ID } from "../api/errors";
import { db } from "../db";
import * as schema from "../db/schema/auth";
import { ensureOrgTasks } from "../db/seed-tasks";
import { isDevAuthEnabled } from "../lib/dev-auth";
import { invitationMail, sendMail } from "../lib/email";
import { externalFetch } from "../lib/http";
import { PLATFORM_ADMIN_ROLE, PLATFORM_USER_ROLE } from "../lib/platform-admin";
import {
	bootstrapSingleOrg,
	findSingleOrg,
	singleOrgSlug,
} from "../lib/single-org";
import { slugify } from "../lib/slug";
import { recordAudit, recordSecurityEvent } from "../services/audit";
import { emitEvent, memberWebhookPayload } from "../services/events";
import {
	enabledOAuthProviders,
	type OAuthProviderConfig,
	onInstanceSettingsChanged,
} from "../services/instance-settings.service";
import { membersService } from "../services/members.service";
import { slackService } from "../services/slack.service";
import {
	callerActor,
	currentCaller,
	hookCtx,
	impersonatorOf,
	INTEGRATION_PROVIDERS,
	originOf,
	recordFailedSignIn,
	recordJoined,
	signInBody,
	signInMethod,
	signInMethodLabel,
} from "./audit-hooks";
import {
	assertMayRegister,
	PASSWORD_SIGN_UP_PATH,
	registrationClosed,
} from "./registration";
import {
	githubCredentials,
	googleCredentials,
	isInstanceEmpty,
	mayUsePassword,
	type OAuthCredentials,
} from "./sign-in-methods";

export { mayClaimInvitation } from "./registration";
export {
	type PasswordSignIn,
	passwordSignIn,
	type SignInProvider,
	signInProviders,
} from "./sign-in-methods";

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

/** An arbitrary constant, shared only with itself. `pg_advisory_xact_lock`
 *  namespaces nothing, so the number has to be unique among the locks this
 *  application takes; it is the only one today. */
const PLATFORM_ADMIN_LOCK = 8_531_207;

/**
 * Give the instance's first account the platform admin role.
 *
 * Whoever deploys Farmer and signs in first operates it — the same shape as
 * single-org mode's "first person to sign in claims the instance", and what
 * issue #75 records for the wider Infrastructure work. Everybody after them is
 * promoted by somebody who already holds it (better-auth's `admin/set-role`).
 * There is no environment variable: the grant is a database value.
 *
 * **The rule is "the oldest `user` row, and only while nobody holds it", not
 * "nobody holds it".** Those come apart on a populated instance: an open
 * deployment accepts a Google sign-up from anybody, so "grant it to the next
 * person who signs in when the role is vacant" hands the deployment to a
 * stranger the moment the one admin is deleted. Being the oldest row is
 * something a later signup can never become.
 *
 * Runs AFTER the insert, because the question is about a row that now exists,
 * and inside an advisory lock, because two first signups a millisecond apart
 * would otherwise both read an empty table and both grant. The lock costs one
 * round trip per account created, once in that account's life.
 *
 * A plain `update`, not the internal adapter: the admin plugin declares `role`
 * with `input: false`, so better-auth's own update path drops it — and it is
 * right to, since the point of that flag is that no request may set its own
 * role. This is the instance bootstrapping itself, not a caller.
 */
const claimPlatformAdmin = async (userId: string) => {
	await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(${PLATFORM_ADMIN_LOCK})`);
		const held = await tx.query.user.findFirst({
			where: eq(schema.user.role, PLATFORM_ADMIN_ROLE),
			columns: { id: true },
		});
		if (held) return;
		const oldest = await tx.query.user.findFirst({
			// `createdAt` alone is not a total order — two rows written in the same
			// millisecond would tie, and the answer has to be the same one every
			// time it is asked.
			orderBy: [asc(schema.user.createdAt), asc(schema.user.id)],
			columns: { id: true },
		});
		if (oldest?.id !== userId) return;
		await tx
			.update(schema.user)
			.set({ role: PLATFORM_ADMIN_ROLE })
			.where(eq(schema.user.id, userId));
	});
};

/**
 * `member.added`, for whoever is listening on the other end of a webhook.
 *
 * The Ctx names the new member as both the organization and the actor, because
 * there is no third party here: accepting an invitation is something a person
 * does to themselves. `emitEvent` never throws, so a webhook cannot cost
 * somebody their membership.
 */
const announceNewMember = async (newMember: {
	organizationId: string;
	userId: string;
	role: string;
}): Promise<void> => {
	const ctx = {
		organizationId: newMember.organizationId,
		userId: newMember.userId,
	};
	await emitEvent(ctx, "member.added", async () => {
		const payload = await memberWebhookPayload(ctx, newMember.userId);
		return payload ? { ...payload, role: newMember.role } : null;
	});
};

const OIDC_DISCOVERY_PATH = "/.well-known/openid-configuration";

/**
 * One OpenID Connect source from the Infrastructure page, as a genericOAuth
 * entry. The base URL is the issuer; the discovery document is found under it
 * unless the operator pasted the discovery URL itself.
 *
 * The provider registers this redirect URI (better-auth 1.6.23,
 * `plugins/generic-oauth/routes.mjs`: `${baseURL}/oauth2/callback/${providerId}`,
 * and `baseURL` carries the `/api/auth` base path):
 *
 *     {origin}/api/auth/oauth2/callback/{providerId}
 *
 * Not a trusted provider for account linking (`trustedProviders` below): a
 * sign-in links to an existing account with the same email only when the
 * source says the email is verified (`email_verified`). The operator chose
 * the source, but an identity provider with open self-registration would
 * otherwise hand out any address it is asked for. The same claim decides
 * whether the address may take an invitation (`./registration.ts`).
 *
 * `trustsEmail` is the operator saying the source checks every address, for
 * one that leaves the claim out (Entra ID's ID token does): every address it
 * hands out then counts as verified.
 */
const oidcProvider = (provider: OAuthProviderConfig): GenericOAuthConfig => {
	const base = provider.baseUrl.replace(/\/+$/, "");
	return {
		providerId: provider.providerId,
		discoveryUrl: base.endsWith(OIDC_DISCOVERY_PATH)
			? base
			: `${base}${OIDC_DISCOVERY_PATH}`,
		clientId: provider.clientId,
		clientSecret: provider.clientSecret,
		scopes:
			provider.scopes.length > 0
				? provider.scopes
				: ["openid", "email", "profile"],
		pkce: true,
		...(provider.trustsEmail && {
			mapProfileToUser: () => ({ emailVerified: true }),
		}),
	};
};

const GITHUB_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";

/** The `error` body GitHub sends with a 200 when it refuses a refresh. */
const githubRefusal = z.object({
	error: z.string(),
	error_description: z.string().optional(),
});

/**
 * Refresh a GitHub user token, and FAIL when GitHub refuses it.
 *
 * `GITHUB_CLIENT_ID` is a GitHub App client id, so a user token is a
 * user-to-server token: it dies after 8 hours, and its refresh token is single
 * use — GitHub invalidates the old one the moment it issues a new pair.
 *
 * GitHub answers a spent refresh token with HTTP **200** and an `error` body
 * (`bad_refresh_token`), not with a 4xx. better-auth's helper only throws on a
 * non-2xx, so it read that as a refresh that succeeded and returned nothing —
 * and `getValidAccessToken` then wrote the refresh token it had READ back over
 * the fresh pair a concurrent caller had just stored. Two callers arriving
 * together at the 8-hour boundary is all it took, and from that second on
 * every refresh failed, the access token died, and the person had to connect
 * GitHub again. The rows said so: a refresh-token expiry OLDER than the
 * access-token expiry, and `updated_at` moving every twenty minutes while
 * neither expiry did.
 *
 * A refresh that produced no access token is a failure. Throwing leaves the
 * stored row exactly as it was, so the caller that won the race keeps its
 * tokens and the one that lost costs a single failed read.
 *
 * The request is better-auth's own (`refreshAccessTokenRequest`: the
 * credentials in the POST body, `accept: application/json`), and the answer
 * goes through `getOAuth2Tokens`, which maps `refresh_token_expires_in` (so the
 * stored refresh-token expiry moves with every renewal) and keeps the raw body
 * for the log below. `github` is the object the provider itself is built
 * from, so the refresh can never send other credentials than the sign-in did.
 *
 * `getValidAccessToken` swallows this throw into a generic
 * `FAILED_TO_GET_ACCESS_TOKEN`, so the refusal is logged here, where GitHub's
 * `error` code is still in hand. The caller has no user id to give; the
 * `[github] getAccessToken failed` line that follows it names the user.
 */
const refreshGithubToken =
	(github: OAuthCredentials) => async (refreshToken: string) => {
		const { body, headers } = await refreshAccessTokenRequest({
			refreshToken,
			options: {
				clientId: github.clientId,
				clientSecret: github.clientSecret,
			},
		});
		// Manual, as better-auth's own fetch is: the endpoint is a constant, but a
		// server-side OAuth call never follows a redirect.
		const response = await externalFetch(GITHUB_TOKEN_ENDPOINT, {
			method: "POST",
			body,
			headers,
			redirect: "manual",
		});
		if (!response.ok) {
			throw new APIError("BAD_REQUEST", {
				message: `GitHub answered the refresh with HTTP ${response.status}`,
				code: "GITHUB_REFRESH_FAILED",
			});
		}
		const tokens = getOAuth2Tokens(await response.json());
		if (!tokens.accessToken) {
			const refusal = githubRefusal.safeParse(tokens.raw);
			console.warn("[github] GitHub refused the refresh token", {
				error: refusal.success ? refusal.data.error : null,
				description: refusal.success ? refusal.data.error_description : null,
			});
			throw new APIError("BAD_REQUEST", {
				message: "GitHub refused the refresh token",
				code: "GITHUB_REFRESH_TOKEN_REFUSED",
			});
		}
		return tokens;
	};

/** Every value `buildAuth` reads from the instance settings, as one string.
 *  When it changes, the instance is rebuilt. */
const authInputs = () =>
	JSON.stringify([
		googleCredentials(),
		githubCredentials(),
		singleOrgSlug(),
		enabledOAuthProviders(),
	]);

/**
 * Build the better-auth instance from the instance settings as they are now.
 *
 * Called once at import and again whenever `authInputs()` changes; see `auth`
 * at the bottom of this file. `bun run auth:generate` imports this module
 * without a database read, so it builds from the environment and the
 * defaults. That is fine: no provider or option below changes the schema.
 */
const buildAuth = () => {
	const google = googleCredentials();
	const github = githubCredentials();
	const singleOrg = singleOrgSlug() !== null;
	return betterAuth({
		database: drizzleAdapter(db, { provider: "pg", schema }),
		// On in every environment, and closed by two gates rather than by this
		// switch, because production needs it for exactly one person:
		//
		// - Development (and `bun test`): open, so a fresh checkout can be signed
		//   into without a Google Cloud project (see lib/dev-auth.ts for why the
		//   gate is NODE_ENV and not an opt-in flag). A password signup still
		//   passes the registration gate, like any other signup.
		// - Production: `/sign-up/email` creates the FIRST account and nothing
		//   else (`assertMayRegister` and `hooks.before` below), because an
		//   instance with no sign-in provider has no other way in, and the first
		//   account is the one that configures one (issue #75, decision 3).
		//   `/sign-in/email` then works only for a platform admin who has no
		//   configured provider connected yet (`mayUsePassword`, checked in
		//   `databaseHooks.session.create.before`, after the password is verified,
		//   so the refusal says nothing to somebody without the password).
		//
		// So it is not a second way in for anybody else: nobody after the first
		// account can get a password, and the first account's password closes the
		// moment it connects a provider.
		emailAndPassword: {
			enabled: true,
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
			// The GitHub and Google Calendar access and refresh tokens are encrypted
			// at rest, keyed from BETTER_AUTH_SECRET, so a database dump is not a
			// set of live credentials for everybody's GitHub and calendar. Rows
			// written before this was on still read: better-auth passes a value that
			// does not look encrypted through as it is, and `sealLegacyOAuthTokens`
			// (./legacy-tokens.ts) encrypts such a row the next time it is used.
			encryptOAuthTokens: true,
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
		// Registered only when both halves are set. With either missing, the
		// provider used to be registered with `undefined` credentials, and a
		// sign-in attempt failed at Google instead of here.
		socialProviders: {
			...(github && {
				github: {
					clientId: github.clientId,
					clientSecret: github.clientSecret,
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
					// See `refreshGithubToken`: GitHub refuses a spent refresh token with a
					// 200, which better-auth's default reads as a successful refresh that
					// returned nothing — and then stores it.
					refreshAccessToken: refreshGithubToken(github),
				},
			}),
			...(google && {
				google: {
					clientId: google.clientId,
					clientSecret: google.clientSecret,
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
			}),
		},
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				// `auth.signed_out`, before the endpoint deletes the session: after
				// it, nothing says whose it was.
				if (ctx.path === "/sign-out") {
					try {
						const ending = await getSessionFromCtx(ctx);
						if (ending) {
							await recordSecurityEvent({
								kind: "auth.signed_out",
								subjectUserId: ending.user.id,
								actorUserId: ending.user.id,
								actor: {
									via: "web",
									impersonatorId: impersonatorOf.parse(
										ending.session.impersonatedBy,
									),
									...originOf(ctx.headers ?? ctx.request?.headers),
								},
							});
						}
					} catch (error) {
						console.error("[audit] could not record a sign-out", error);
					}
					return;
				}
				// Refuse a production password signup before better-auth looks the
				// email up. Its own "user already exists" answer would otherwise tell an
				// anonymous visitor which addresses have an account.
				if (ctx.path !== PASSWORD_SIGN_UP_PATH || isDevAuthEnabled()) return;
				if (!(await isInstanceEmpty())) throw registrationClosed();
			}),
			// `auth.sign_in_failed`. After the endpoint, because only its answer
			// says the password was wrong (or that password sign-in is closed for
			// the account, which is also a sign-in that did not happen).
			after: createAuthMiddleware(async (ctx) => {
				if (ctx.path !== "/sign-in/email") return;
				const returned = ctx.context.returned;
				if (!isAPIError(returned)) return;
				const parsed = signInBody.safeParse(ctx.body);
				if (!parsed.success) return;
				await recordFailedSignIn(
					parsed.data.email,
					ctx.headers ?? ctx.request?.headers,
					returned.body?.code ?? null,
				);
			}),
		},
		databaseHooks: {
			user: {
				create: {
					// The registration gate: the first account, an invited person,
					// or anybody while `REGISTRATION_OPEN` is on; single-org mode is
					// stricter. It lives here, on user creation, rather than on a
					// screen, because signing in with Google *is* the signup — a
					// first-time user is created on the way through the OAuth
					// callback, with no form anywhere in the path. The rules and the
					// reason the thrown error carries a `code` are in
					// `./registration.ts`.
					before: async (user, context) => {
						await assertMayRegister(user, context?.path);
					},
					after: async (user) => {
						// Before either branch: an instance's first account operates it
						// whether or not it is in single-org mode, and whether or not the
						// organization bootstrap below has anything to do.
						await claimPlatformAdmin(user.id);

						if (singleOrg) {
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
					before: async (session, context) => {
						// The production password gate (see `emailAndPassword` above).
						// Here rather than before the endpoint, because by now the
						// password has been checked: a wrong password gets better-auth's
						// usual answer, and only somebody who holds the right one learns
						// that password sign-in is closed for them.
						if (
							context?.path === "/sign-in/email" &&
							!(await mayUsePassword(session.userId))
						) {
							throw new APIError("FORBIDDEN", {
								code: "PASSWORD_SIGN_IN_CLOSED",
								message:
									"Password sign-in is closed for this account. Sign in with the provider you connected.",
							});
						}
						// In single-org mode, pin the session to *the* organization rather
						// than to whichever membership happens to come back first. Only
						// matters for a database that had several organizations before the
						// mode was switched on — but that's exactly when picking the wrong
						// one would be hardest to notice.
						const theOrg = singleOrg ? await findSingleOrg() : null;
						const membership = await db.query.member.findFirst({
							where: theOrg
								? and(
										eq(schema.member.userId, session.userId),
										eq(schema.member.organizationId, theOrg.id),
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
						return {
							data: { activeOrganizationId: membership.organizationId },
						};
					},
					// `auth.signed_in`, once the session exists. Not for an
					// impersonated session: `impersonation.started` records that, as
					// the operator's act rather than the person's sign-in.
					after: async (created, context) => {
						if (impersonatorOf.parse(created.impersonatedBy)) return;
						const path = context?.path;
						const origin = originOf(
							context?.headers ?? context?.request?.headers,
						);
						await recordSecurityEvent({
							kind: "auth.signed_in",
							subjectUserId: created.userId,
							actorUserId: created.userId,
							actor: {
								// The device flow's token endpoint makes the CLI's session.
								via: path?.startsWith("/device") ? "cli" : "web",
								ip: origin.ip,
								userAgent: origin.userAgent ?? created.userAgent ?? null,
							},
							target: { type: "session", id: created.id, label: null },
							details: { method: signInMethod(path) },
						});
					},
				},
			},
			account: {
				create: {
					// `account.linked`: a new way in for somebody who already had one.
					// The first account row is the signup itself, which
					// `auth.signed_in` records, so a person with one row is skipped.
					after: async (created, context) => {
						if (INTEGRATION_PROVIDERS.has(created.providerId)) return;
						try {
							const [held] = await db
								.select({ n: count() })
								.from(schema.account)
								.where(eq(schema.account.userId, created.userId));
							if ((held?.n ?? 0) <= 1) return;
							const caller = await currentCaller();
							const origin = originOf(
								context?.headers ?? context?.request?.headers,
							);
							await recordSecurityEvent({
								kind: "account.linked",
								subjectUserId: created.userId,
								actorUserId: created.userId,
								actor: { ...callerActor(caller, "web"), ...origin },
								target: {
									type: "account",
									id: created.id,
									label: signInMethodLabel(created.providerId),
								},
							});
						} catch (error) {
							console.error("[audit] could not record a linked account", error);
						}
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
				allowUserToCreateOrganization: !singleOrg,
				disableOrganizationDeletion: singleOrg,
				// better-auth's default is 100: accepting an invitation or adding a
				// member is refused at 100 members. A Harvest import brings every
				// former employee in as an archived member, so a real org passes 100
				// at once. (Its `listMembers` breaks there too, whatever this says —
				// see `membersService.roster`.)
				membershipLimit: 10_000,
				// An invitation is matched by address, so only a verified address
				// may accept one; see `mayClaimInvitation` in `./registration.ts`.
				// Off in development, where no password account is ever verified.
				requireEmailVerificationOnInvitation: !isDevAuthEnabled(),
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
				//
				// They are also where `member.added` is emitted for outbound webhooks
				// (issue #67), and for the same reason: joining an organization has no
				// service function of its own, because better-auth owns both paths.
				//
				// And they, with the four below, are where member management reaches
				// the audit log. The actor is the caller of the endpoint
				// (`currentCaller`), because a hook names the member acted on.
				organizationHooks: {
					afterAcceptInvitation: async ({ member: newMember, user }) => {
						await slackService.linkMember(
							newMember.organizationId,
							newMember.userId,
						);
						await announceNewMember(newMember);
						await recordJoined(newMember, user.name);
					},
					afterAddMember: async ({ member: newMember, user }) => {
						await slackService.linkMember(
							newMember.organizationId,
							newMember.userId,
						);
						await announceNewMember(newMember);
						await recordJoined(newMember, user.name);
					},
					afterCreateInvitation: async ({
						invitation: invited,
						inviter,
						organization: org,
					}) => {
						const caller = await currentCaller();
						await recordAudit(hookCtx(org.id, caller, inviter.id), {
							kind: "member.invited",
							target: {
								type: "invitation",
								id: invited.id,
								label: invited.email,
							},
							details: { role: invited.role },
						});
					},
					afterCancelInvitation: async ({
						invitation: cancelled,
						cancelledBy,
						organization: org,
					}) => {
						const caller = await currentCaller();
						await recordAudit(hookCtx(org.id, caller, cancelledBy.id), {
							kind: "member.invitation_cancelled",
							target: {
								type: "invitation",
								id: cancelled.id,
								label: cancelled.email,
							},
							details: { role: cancelled.role },
						});
					},
					afterRemoveMember: async ({
						member: removed,
						user,
						organization: org,
					}) => {
						const caller = await currentCaller();
						await recordAudit(hookCtx(org.id, caller, null), {
							kind: "member.removed",
							subjectUserId: removed.userId,
							target: { type: "member", id: removed.userId, label: user.name },
							details: { role: removed.role },
						});
					},
					afterUpdateMemberRole: async ({
						member: updated,
						previousRole,
						user,
						organization: org,
					}) => {
						if (previousRole === updated.role) return;
						const caller = await currentCaller();
						await recordAudit(hookCtx(org.id, caller, null), {
							kind: "member.role_changed",
							subjectUserId: updated.userId,
							target: { type: "member", id: updated.userId, label: user.name },
							changes: { role: { from: previousRole, to: updated.role } },
						});
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
							// Date#getDay() numbering: 1 = Monday, 0 = Sunday. See
							// `WeekStartsOn` in lib/time.ts.
							weekStartsOn: {
								type: "number",
								required: true,
								defaultValue: 1,
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
					void sendMail(
						invitationMail({
							to: data.email,
							inviterName: data.inviter.user.name,
							organizationName: data.organization.name,
							role: data.role,
							link,
						}),
					).then(
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
			//
			// The same plugin carries every OpenID Connect source from the
			// Infrastructure page (`oidcProvider` above). The calendar entry is only
			// there when Google is configured.
			genericOAuth({
				config: [
					...(google
						? [
								{
									providerId: "google-calendar",
									discoveryUrl:
										"https://accounts.google.com/.well-known/openid-configuration",
									clientId: google.clientId,
									clientSecret: google.clientSecret,
									pkce: true,
									// genericOAuth does not add better-auth's default identity scopes,
									// so request them explicitly alongside calendar.events.readonly.
									// Read-only is all the app needs: the picker and the meeting engine
									// list and look up events, and nothing writes to a calendar. Ask
									// for write access again only together with the code that uses it.
									scopes: [
										"openid",
										"email",
										"profile",
										"https://www.googleapis.com/auth/calendar.events.readonly",
									],
									// Google only returns a refresh token when offline access is
									// requested AND consent is re-prompted; without both, the ~1h access
									// token can't be refreshed server-side and reads break after expiry.
									accessType: "offline",
									prompt: "consent",
								} satisfies GenericOAuthConfig,
							]
						: []),
					...enabledOAuthProviders().map(oidcProvider),
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
			// The command-line tool's sign-in: RFC 8628's device flow. `farmer login`
			// asks `/device/code` for a pair of codes, the person approves the user
			// code on `/device` in a browser where they are already signed in, and the
			// CLI's poll of `/device/token` comes back with `access_token` =
			// `session.token`. So the CLI holds an ordinary better-auth session row,
			// which is what lets Preferences list it and revoke it like any other.
			//
			// The server reads that token itself, in `resolveCliUser`
			// (`apps/web/src/server/api-auth.ts`), and deliberately NOT through the
			// `bearer` plugin: that plugin makes an `Authorization` header a session
			// for EVERY endpoint and server function, which is a far wider change than
			// one API surface needs, and it would break the credential order that
			// `resolveMcpOrgContext` relies on.
			//
			// `validateClient` accepts only the CLI's own id. Nothing else in this app
			// runs the device flow, and an open client list is a code any third party
			// can start and then phish somebody into approving.
			//
			// `expiresIn: "10m"`, down from the plugin's 30. The code lifetime is the
			// phishing window: an attacker who starts a flow must get the person to
			// approve that exact code before it dies, and ten minutes is still plenty
			// for someone who is looking at their own terminal.
			//
			// Mounted whatever `CLI_ENABLED` says, like `mcp` above; the catch-all
			// auth route answers 404 for these paths when the flag is off.
			deviceAuthorization({
				validateClient: (clientId) => clientId === CLI_CLIENT_ID,
				expiresIn: "10m",
				verificationUri: "/device",
			}),
			// Impersonation, and nothing else this plugin offers.
			//
			// It exists so somebody operating the deployment can answer "it doesn't
			// work for me" by looking at the screen the person is looking at. A
			// timesheet is assembled from that person's memberships, project
			// assignments, working hours, calendar grants and filing rules, and no
			// admin view reproduces that combination — reading the database tells you
			// what the rows say, not what the app draws from them.
			//
			// **Who may do it is `user.role`, not an org role.** See
			// `lib/platform-admin.ts` for why the two are deliberately different
			// columns, and `claimPlatformAdmin` above for how the first one is
			// written. Every one after that comes from this plugin's own
			// `admin/set-role`, which requires the role it grants.
			//
			// `roles` has to be given explicitly, and is not decoration. The plugin
			// resolves a permission by looking the session user's role up in this map
			// (`hasPermission` in better-auth's admin plugin); `adminRoles` only says
			// which roles count as "an admin you may not impersonate". Name a role in
			// `adminRoles` without putting it in `roles` and every check fails
			// closed — the endpoint 403s for the very people it was added for.
			//
			// The plugin's other endpoints (ban, set-role, create-user, delete-user,
			// list-users) are mounted too and cannot be switched off individually.
			// `adminAc` grants them, so a platform admin can reach them over the API.
			// Nothing in this app's UI calls them, and they are not an escalation
			// beyond impersonation, which already lets you become anyone.
			admin({
				roles: { [PLATFORM_ADMIN_ROLE]: adminAc, [PLATFORM_USER_ROLE]: userAc },
				adminRoles: [PLATFORM_ADMIN_ROLE],
				defaultRole: PLATFORM_USER_ROLE,
				// An hour, the plugin's own default, stated here because it is a
				// security property rather than a preference: the impersonated session
				// is a real session row for the other person, and this is how long it
				// lives if nobody presses Stop. Signing out ends it too, but the
				// sidebar's Stop is the way back, because it restores the operator's own
				// session instead of leaving them at the login screen.
				impersonationSessionDuration: 60 * 60,
			}),
			// tanstackStartCookies MUST stay last — see better-auth/better-auth#5639
			tanstackStartCookies(),
		],
	});
};

type Auth = ReturnType<typeof buildAuth>;

let current: Auth = buildAuth();
let currentInputs = authInputs();

/** The instance for the settings as they are now, rebuilt if they moved. */
const liveAuth = (): Auth => {
	const inputs = authInputs();
	if (inputs !== currentInputs) {
		current = buildAuth();
		currentInputs = inputs;
	}
	return current;
};

/**
 * Issue #75's open question — does saving a provider need a restart? No.
 *
 * better-auth takes its providers once, when the instance is built, so the
 * instance is rebuilt when a setting it was built from changes. In the process
 * that saved the change, the write refreshes the settings and the listener
 * below rebuilds at once. Another process (the worker, a second web replica)
 * reads the change at its next refresh, within the refresh interval
 * (`REFRESH_TTL_MS` in `services/instance-settings.service.ts`), and
 * rebuilds then.
 *
 * The listener is the eager path. `liveAuth()` also compares the inputs on
 * every read, because the first load of the settings fires no listener (it is
 * not a change), and this module can be imported before that first load.
 */
onInstanceSettingsChanged(() => {
	liveAuth();
});

/**
 * The better-auth instance. Each key is a getter that reads the current
 * build, so a caller that holds `auth` (through
 * `await import("@farmer/core/auth")`, or a static import in a service) never
 * holds a stale one. A caller that keeps `auth.api` in a variable does, so
 * nobody does that.
 *
 * The type is the inferred better-auth type, unchanged, so `auth.api.*`,
 * `auth.handler` and `auth.$context` all type as before. The object is
 * written out key by key rather than as a Proxy so that no cast is needed:
 * if better-auth adds a key, this stops compiling until it is added here.
 */
export const auth: Auth = {
	get handler() {
		return liveAuth().handler;
	},
	get api() {
		return liveAuth().api;
	},
	get options() {
		return liveAuth().options;
	},
	get $context() {
		return liveAuth().$context;
	},
	get $ERROR_CODES() {
		return liveAuth().$ERROR_CODES;
	},
	get $Infer() {
		return liveAuth().$Infer;
	},
};
