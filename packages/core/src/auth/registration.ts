import { APIError } from "better-auth/api";

import { isDevAuthEnabled } from "../lib/dev-auth";
import { settingEnabled } from "../lib/instance-settings";
import {
	findPendingInvitation,
	findSingleOrg,
	isSingleOrgMode,
} from "../lib/single-org";
import { isInstanceEmpty } from "./sign-in-methods";

/**
 * Who may create an account. Called from `databaseHooks.user.create.before`
 * in `./index.ts`, because signing in with Google or an OpenID Connect source
 * IS the signup: the user row is created in the middle of the OAuth callback,
 * with no form in the path. One hook is the only place that covers every way
 * a user row is made.
 *
 * Issue #75, decision 3: the first account configures the instance, and then
 * registration closes. In order:
 *
 * 1. Single-org mode with its organization claimed: an invitation to THAT
 *    organization, or `INVITE_ONLY`. `REGISTRATION_OPEN` does not widen it;
 *    the mode is the operator saying "one workspace, by invitation".
 * 2. A password signup outside development: only the first account. The
 *    password form exists in production for the bootstrap and nothing else
 *    (see `passwordSignIn` in `./sign-in-methods.ts`).
 * 3. The instance has no user: allowed. This account becomes the platform
 *    admin (`claimPlatformAdmin`) and, in single-org mode, claims the
 *    organization.
 * 4. A pending invitation in any organization, for a verified address:
 *    allowed.
 * 5. `REGISTRATION_OPEN`: allowed.
 * 6. Otherwise `REGISTRATION_CLOSED`.
 *
 * An invitation is matched by address alone, so it counts only when the
 * address is verified (`mayClaimInvitation`). An OpenID Connect source with
 * open self-registration hands out any address it is asked for, unverified;
 * without the check, a stranger there could take an invitation meant for
 * somebody else, admin role and all. The same check guards accepting one
 * (`requireEmailVerificationOnInvitation` in `./index.ts`) and listing one
 * (`listMyPendingInvitations` in the web app).
 *
 * Single-org mode with its organization NOT claimed yet falls through to 3-6.
 * It used to be open to anybody, which on a populated instance handed the
 * organization to whichever stranger signed up first.
 *
 * The `code` of each APIError is load-bearing: better-auth's OAuth callbacks
 * (the social one and genericOAuth's) turn a thrown APIError into a redirect
 * to `errorCallbackURL` only when it carries a `code`, with the message as
 * `error_description`. Without one the visitor gets a raw 403 in the middle of
 * the round trip instead of the login page's message.
 *
 * "The instance has no user" is a read before a write, so two first signups
 * in the same instant can both pass. The cost is a second ordinary account;
 * the platform admin role still goes to the oldest row only.
 */

/** The admin plugin checks its own permission before it creates a user. */
const ADMIN_CREATE_USER_PATH = "/admin/create-user";
export const PASSWORD_SIGN_UP_PATH = "/sign-up/email";

export const registrationClosed = () =>
	new APIError("FORBIDDEN", {
		code: "REGISTRATION_CLOSED",
		message:
			"This instance does not accept new accounts. Ask an administrator to invite you, then sign in with the address the invitation was sent to.",
	});

const inviteOnly = () =>
	new APIError("FORBIDDEN", {
		code: "INVITE_ONLY",
		message:
			"This workspace is invite-only. Sign in with the account the invitation was sent to, or ask an admin to invite you.",
	});

/**
 * Whether an address may claim an invitation sent to it. Verified, or any
 * address in development: no verification flow exists in this app, so a dev
 * password account is never verified, and the password form there lets
 * anybody be anybody anyway (`lib/dev-auth.ts`).
 */
export const mayClaimInvitation = (emailVerified: boolean): boolean =>
	emailVerified || isDevAuthEnabled();

export const assertMayRegister = async (
	user: { email: string; emailVerified: boolean },
	path: string | undefined,
): Promise<void> => {
	if (path === ADMIN_CREATE_USER_PATH) return;
	const { email } = user;
	const invited = async (organizationId: string | null) =>
		mayClaimInvitation(user.emailVerified) &&
		(await findPendingInvitation(organizationId, email)) !== null;
	if (isSingleOrgMode()) {
		const org = await findSingleOrg();
		if (org) {
			if (await invited(org.id)) return;
			throw inviteOnly();
		}
	}
	const empty = await isInstanceEmpty();
	if (path === PASSWORD_SIGN_UP_PATH && !isDevAuthEnabled()) {
		if (empty) return;
		throw registrationClosed();
	}
	if (empty) return;
	if (await invited(null)) return;
	if (settingEnabled("REGISTRATION_OPEN")) return;
	throw registrationClosed();
};
