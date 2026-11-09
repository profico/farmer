import { APIError } from "better-auth/api";

import { isDevAuthEnabled } from "../lib/dev-auth";
import { hasClaimableImport } from "../lib/import-claimable";
import { settingEnabled } from "../lib/instance-settings";
import {
	findPendingInvitation,
	findSingleOrg,
	isSingleOrgMode,
} from "../lib/single-org";
import { isInstanceEmpty } from "./sign-in-methods";

/**
 * Who may create an account. Called from `databaseHooks.user.create.before`
 * in `./index.ts`. A sign-in with Google or an OpenID Connect source is the
 * signup, so the user row is made in the middle of the OAuth callback. This
 * one hook covers every way to make a user row.
 *
 * Issue #75, decision 3: the first account configures the instance, and then
 * registration closes. In order:
 *
 * 1. Single-org mode with its organization claimed: an invitation to that
 *    organization, or `INVITE_ONLY`. `REGISTRATION_OPEN` does not widen it.
 * 2. A password signup outside development: only the first account (see
 *    `passwordSignIn` in `./sign-in-methods.ts`).
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
 * open self-registration gives out any address, unverified. Without the check,
 * a stranger could take an invitation for somebody else, admin role included.
 * `requireEmailVerificationOnInvitation` in `./index.ts` and
 * `listMyPendingInvitations` in the web app use the same check.
 *
 * Single-org mode with an unclaimed organization falls through to 3-6.
 *
 * The `code` of each APIError is required. better-auth's OAuth callbacks
 * redirect to `errorCallbackURL` only when the thrown APIError has a `code`.
 * Without one the visitor gets a raw 403 in the middle of the round trip.
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

/** The owner of an address that a Harvest import holds history for signs up
 *  to claim it, with the same verified-address rule as an invitation. */
const claimsImport = async (user: {
	email: string;
	emailVerified: boolean;
}): Promise<boolean> =>
	mayClaimInvitation(user.emailVerified) && hasClaimableImport(user.email);

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
	if ((await invited(null)) || (await claimsImport(user))) return;
	if (settingEnabled("REGISTRATION_OPEN")) return;
	throw registrationClosed();
};
