import { eq } from "drizzle-orm";

import { db } from "../db";
import { account, user } from "../db/schema/auth";
import { isDevAuthEnabled } from "../lib/dev-auth";
import { setting } from "../lib/instance-settings";
import { PLATFORM_ADMIN_ROLE } from "../lib/platform-admin";
import { enabledOAuthProviders } from "../services/instance-settings.service";

/**
 * Which ways into this instance exist right now, from the instance settings.
 *
 * The auth instance (`./index.ts`) is built from these, the login page is
 * drawn from them (`getPublicAppConfig`), and the password gates read them.
 * One module, so the three cannot disagree about what "configured" means.
 *
 * Every read is synchronous except the ones that ask the database about
 * accounts. See ADR 0004 for why a setting is read from a snapshot.
 */

export type OAuthCredentials = { clientId: string; clientSecret: string };

const credentials = (
	clientId: string | undefined,
	clientSecret: string | undefined,
): OAuthCredentials | null =>
	clientId && clientSecret ? { clientId, clientSecret } : null;

/** The Google OAuth client, or null when either half is missing. It serves
 *  both "Sign in with Google" and the `google-calendar` grant. */
export const googleCredentials = () =>
	credentials(setting("GOOGLE_CLIENT_ID"), setting("GOOGLE_CLIENT_SECRET"));

/** The GitHub OAuth app. It links an account for commit tracking; it is not
 *  offered as a way to sign in. */
export const githubCredentials = () =>
	credentials(setting("GITHUB_CLIENT_ID"), setting("GITHUB_CLIENT_SECRET"));

export type SignInProvider = { id: string; name: string };

/** The buttons on the login page: Google when it is configured, then every
 *  OpenID Connect source that is switched on. No secrets. */
export const signInProviders = (): SignInProvider[] => [
	...(googleCredentials() ? [{ id: "google", name: "Google" }] : []),
	...enabledOAuthProviders().map((provider) => ({
		id: provider.providerId,
		name: provider.name,
	})),
];

/** True when the instance has no `user` row yet. */
export const isInstanceEmpty = async (): Promise<boolean> =>
	!(await db.query.user.findFirst({ columns: { id: true } }));

/**
 * The platform admins who can sign in with a password and with nothing else
 * that is configured now.
 *
 * Outside development this is the whole list of people who may use a
 * password. The first account on an instance with no sign-in provider is
 * created with one (see `passwordSignIn`), and it keeps that way in until it
 * connects a provider in Preferences → Sign-in methods. It is not closed the
 * moment somebody configures a provider, because a provider with a wrong
 * secret would then lock the only administrator out.
 *
 * Restricted to platform admins so that a database copied from development,
 * full of password accounts, does not open a password door for all of them.
 */
const passwordOnlyAdmins = async (): Promise<Set<string>> => {
	const rows = await db
		.select({ userId: account.userId, providerId: account.providerId })
		.from(account)
		.innerJoin(user, eq(user.id, account.userId))
		.where(eq(user.role, PLATFORM_ADMIN_ROLE));
	const signIn = new Set(signInProviders().map((provider) => provider.id));
	const withPassword = new Set<string>();
	const linked = new Set<string>();
	for (const row of rows) {
		if (row.providerId === "credential") withPassword.add(row.userId);
		if (signIn.has(row.providerId)) linked.add(row.userId);
	}
	return new Set([...withPassword].filter((id) => !linked.has(id)));
};

/** May this person sign in with a password now? Always in development. */
export const mayUsePassword = async (userId: string): Promise<boolean> =>
	isDevAuthEnabled() || (await passwordOnlyAdmins()).has(userId);

/**
 * What the login page offers for a password, outside development.
 *
 * - `first-account`: the instance has no user. The form creates the first
 *   account, which becomes the platform admin and configures the rest
 *   (issue #75, decision 3).
 * - `administrator`: a platform admin still has only a password (see
 *   `passwordOnlyAdmins`). The form signs in; it never creates an account.
 * - `null`: no password form. Development returns null too, because it has
 *   its own form (`devAuth`).
 */
export type PasswordSignIn = "first-account" | "administrator" | null;

export const passwordSignIn = async (): Promise<PasswordSignIn> => {
	if (isDevAuthEnabled()) return null;
	if (await isInstanceEmpty()) return "first-account";
	return (await passwordOnlyAdmins()).size > 0 ? "administrator" : null;
};
