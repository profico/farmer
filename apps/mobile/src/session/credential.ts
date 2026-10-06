/**
 * What kind of credential the app holds. A session token comes from a
 * sign-in in the app, and the app owns it. An API token (`fmr_...`) is one
 * that the person made in Preferences and pasted here. Other clients (a
 * script, the CLI) can use the same API token, so a sign-out in the app must
 * not revoke it: the app only forgets it, as the CLI does for `FARMER_TOKEN`.
 */

/** The prefix of an API token (`packages/core/src/api/tokens.ts`). */
export const API_TOKEN_PREFIX = "fmr_";

/** Whether the credential is an API token that the person pasted. */
export const isApiToken = (token: string): boolean =>
	token.startsWith(API_TOKEN_PREFIX);

/** Whether a sign-out revokes the credential on the server. */
export const revokesOnSignOut = (token: string): boolean => !isApiToken(token);
