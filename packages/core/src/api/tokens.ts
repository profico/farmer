/**
 * Personal API tokens, as far as a client needs to know about them.
 *
 * A token is `fmr_` and 43 base64url characters. The prefix is how the server
 * tells a token from a device-flow session token before it reads the database,
 * and how a secret scanner recognises one that leaked into a repository. The
 * rest of the design is in `docs/domains/api-tokens.md`.
 */

export const API_TOKEN_PREFIX = "fmr_";

/**
 * What a token may do. `read` answers GET and nothing else; `write` is
 * everything the person can do. There is no finer grain on purpose: every
 * route already stops at what the PERSON may do, so a scope only has to say
 * whether the token may change anything.
 */
export const API_TOKEN_SCOPES = ["read", "write"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

/** Whether a bearer credential is a personal API token rather than a
 *  device-flow session token. Shape only: it says nothing about validity. */
export const isApiToken = (credential: string): boolean =>
	credential.startsWith(API_TOKEN_PREFIX);
